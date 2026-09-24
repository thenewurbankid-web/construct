// #330 slice A -- cloning a public repository into the workspace, as a cancellable job.
//
// A clone happens BEFORE any project is open, and the process runtime (processesService) is per project with a
// flow registry that is the CLI's own list, so a clone is a small process-shaped job of its own: the same
// states (queued/running/done/failed/cancelled), a log, a cancel, and a summary the Processes drawer lists.
//
// Everything that could hurt lives here, in order:
//   1. the URL is validated by gitUrl.mjs (https, allowlisted host, no userinfo, exactly owner/repo);
//   2. the host must resolve ONLY to public addresses (no SSRF into the machine's own network) and that
//      answer is pinned into git (`http.curloptResolve`) so git cannot be handed a different one (rebinding);
//   3. the destination is `<workspace>/<slug>`, checked by workspace.contain(), and must not exist;
//   4. git runs as an argv array (never a shell) with protocols locked to https, no credential helper, no
//      prompts, no hooks, no redirects, no submodules, a scrubbed environment, a process group of its own,
//      a wall-clock cap and a size cap that kills it;
//   5. cancel, failure, timeout and overflow all remove the partial directory (only one this job created);
//   6. (#422) a clone never outlives the server: every live child's process group is SIGKILLed when the server
//      exits or is signalled, and a marker `<workspace>/.construct-clone-<slug>.json` written before git starts
//      (removed on every outcome) lets the next start find a partial directory a crashed server left behind,
//      stop the orphaned git if it is still running, and remove exactly that directory — never one without a marker.
import { spawn as nodeSpawn } from 'node:child_process';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { CloneInputError, DEFAULT_CLONE_HOSTS, isPublicAddress, parseCloneUrl, validateBranch, validateSlug } from './gitUrl.mjs';
import { AUTH_MESSAGE, AUTH_MESSAGE_WITH_TOKEN, NOT_VISIBLE_CODE, NOT_VISIBLE_MESSAGE, createAskpass, feedToken, looksLikeAuthFailure, makeRedactor, parseToken, scrubGitConfig, wipe } from './cloneAuth.mjs';
import { WorkspaceError, contain } from './workspace.mjs';
import { MIN_GIT_FOR_CURLOPT_RESOLVE, formatVersion, gitVersion, supportsCurloptResolve } from '../../../packages/engine/gitVersion.mjs';

export const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
/** #638: the only hosts the person's GitHub login (repoConnection.mjs) may be sent to, whatever CONSTRUCT_CLONE_HOSTS allows. */
export const LOGIN_HOSTS = Object.freeze(['github.com']);
const KEEP_FINISHED = 20;
const LOG_LIMIT = 200;
const SIZE_POLL_MS = 500;
const KILL_GRACE_MS = 2000;
const MAX_DEPTH = 1_000_000;

/** Bytes under `dir` (lstat only, never follows a link), stopping early once `limit` is passed. */
export function dirBytes(dir, limit = Infinity) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      try {
        const st = fs.lstatSync(p);
        total += st.size;
        if (total > limit) return total;
        if (st.isDirectory()) stack.push(p);
      } catch {
        /* vanished mid-walk */
      }
    }
  }
  return total;
}

/** The environment git runs in: nothing inherited but PATH, and no config file, proxy, askpass or helper. */
export function cloneEnv({ allowLocal = false, base = process.env, askpass = null } = {}) {
  return {
    PATH: base.PATH ?? '/usr/bin:/bin',
    HOME: '/nonexistent',
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    // #330 slice B: '/bin/false' (never answers) unless THIS job has a token, in which case the per-job helper.
    GIT_ASKPASS: askpass || '/bin/false',
    GIT_ALLOW_PROTOCOL: allowLocal ? 'https:file' : 'https',
    GIT_PROTOCOL_FROM_USER: '0',
  };
}

/** The exact argv handed to git (after the `git` program name). Exported so a test can assert every flag. */
export function cloneArgs({ parsed, dest, depth = null, branch = null, pin = null, allowLocal = false }) {
  const args = [
    '-c', 'protocol.allow=never',
    '-c', 'protocol.https.allow=always',
    ...(allowLocal && parsed.kind === 'file' ? ['-c', 'protocol.file.allow=always'] : []),
    '-c', 'credential.helper=',
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false',
    '-c', 'http.followRedirects=false',
    '-c', 'http.proxy=',
    '-c', 'transfer.fsckObjects=true',
    ...(pin ? ['-c', `http.curloptResolve=${pin}`] : []),
    'clone', '--progress', '--no-recurse-submodules',
    ...(depth ? ['--depth', String(depth)] : []),
    ...(branch ? ['--branch', branch] : []),
    '--', parsed.url, dest,
  ];
  return args;
}

const isLive = (s) => s === 'running' || s === 'cancelling';

// ---- #422: children die with the server ----------------------------------------------------------------------

// A leading dot can never be a valid slug (validateSlug refuses `.hidden`), so a marker cannot collide with a
// project folder; it sits BESIDE the destination because git refuses to clone into a non-empty directory.
export const MARKER_PREFIX = '.construct-clone-';
export const markerPath = (root, slug) => path.join(root, `${MARKER_PREFIX}${slug}.json`);

const liveChildren = new Set();
const liveAskpass = new Set();
let handlersInstalled = false;

function killGroupOf(child, sig) {
  try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } }
}

/** SIGKILL every live clone's process group. Registered on exit and on the terminating signals; exported for tests. */
export function killLiveCloneGroups() {
  for (const child of liveChildren) killGroupOf(child, 'SIGKILL');
  liveChildren.clear();
  for (const a of liveAskpass) a.cleanup(); // the helper scripts hold no secret, but they should not outlive us
  liveAskpass.clear();
}

/** How many clone children are alive right now (test seam). */
export const liveCloneChildren = () => liveChildren.size;

// `exit` covers a normal end and process.exit(); a signal with its default disposition does not run `exit`
// handlers, so SIGINT/SIGTERM/SIGHUP are handled the same way test-utils/tmpdir.mjs and gitTrees.mjs do: clean
// up, drop the handler, re-raise so the exit status still says "killed by that signal".
function installExitHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('exit', killLiveCloneGroups);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => {
      killLiveCloneGroups();
      process.removeListener(signal, handler);
      process.kill(process.pid, signal);
    };
    process.on(signal, handler);
  }
}

/** True only when the pid provably no longer exists (ESRCH). EPERM, our own pid and nonsense count as alive. */
function pidIsGone(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code === 'ESRCH';
  }
}

/** True when `pid` is a git process working on `dest` (Linux /proc only; anywhere else the answer is "no", and nothing is killed). */
function isOurGit(pid, dest) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    return /^git(-|$)/.test(path.basename(argv[0] || '')) && argv.includes(dest);
  } catch {
    return false;
  }
}

// ---- #330 slice B: what a finished clone looks like on disk ---------------------------------------------------

/** Proof, inside the clone's own metadata directory, that THIS Cockpit made it ("Pull latest" touches only these). */
export const CLONE_STAMP = 'construct-cloned.json';
export const stampPath = (dest) => path.join(dest, '.git', CLONE_STAMP);

/** After the clone reports done: make sure the recorded origin is the plain address with no credentials, that the
 * token is nowhere in the repository configuration, and stamp the clone. -> null when fine, or a plain-words
 * problem (the clone is then removed). A missing `.git` (a stubbed process in a unit test) is not a problem. */
function sealClone(j, tokenBuf) {
  const cfg = path.join(j.dest, '.git', 'config');
  let text;
  try { text = fs.readFileSync(cfg, 'utf8'); } catch { return null; }
  const scrubbed = scrubGitConfig(text, tokenBuf);
  // The recorded origin is exactly the address that was validated, whatever was written.
  const next = scrubbed.text.replace(/(\[remote "origin"\][^[]*?\burl\s*=\s*)[^\r\n]*/, (_m, pre) => `${pre}${j.url}`);
  if (scrubbed.stillHasToken && next.includes(tokenBuf.toString('latin1'))) {
    return 'The clone was stopped and removed: the repository configuration would have kept the access token, which must never be stored.';
  }
  try {
    if (next !== text) fs.writeFileSync(cfg, next);
    fs.writeFileSync(stampPath(j.dest), `${JSON.stringify({ slug: j.slug, url: j.url, branch: j.branch ?? null, at: new Date().toISOString() })}\n`);
  } catch {
    return 'The clone finished but could not be recorded, so it was removed.';
  }
  return null;
}

/**
 * @param {{
 *   getRoot: () => string,                     the realpath'd workspace root
 *   hosts?: readonly string[],
 *   localRoot?: string|null,                     TEST HARNESS ONLY: also allow file:// URLs under this directory
 *   lookup?: (host:string) => Promise<{address:string}[]>,
 *   spawn?: typeof nodeSpawn,
 *   gitCheck?: () => ReturnType<typeof gitVersion>,   #423: which git is installed (default: ask `git --version` once)
 *   loginToken?: (sessionKey:string) => Promise<Buffer|null>,   #638: a Buffer COPY of the session's GitHub login token (the job zeroes it), or null
 *   loginHosts?: readonly string[],                              #638: hosts the login token may be used for (default github.com)
 *   maxBytes?: number, timeoutMs?: number, sizePollMs?: number,
 * }} deps
 */
export function createCloneJobs({
  getRoot,
  hosts = DEFAULT_CLONE_HOSTS,
  localRoot = null,
  lookup = (h) => dns.lookup(h, { all: true, verbatim: true }),
  spawn = nodeSpawn,
  gitCheck = gitVersion,
  loginToken = null,
  loginHosts = LOGIN_HOSTS,
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sizePollMs = SIZE_POLL_MS,
} = {}) {
  const jobs = new Map(); // id -> record
  const reserved = new Set(); // slugs of live jobs

  /**
   * #423: whether clone may run on this machine's git. Below 2.37.0 git silently ignores `http.curloptResolve`,
   * the pin that keeps git on the addresses that were just checked to be public, so the anti-rebinding half of the
   * SSRF defence would be off without a word. Refused rather than degraded: a clone with half its defence is not
   * one we want to run. -> {ok, version, minimum, cloneEnabled, reason?, code?}
   */
  function gitStatus() {
    const minimum = formatVersion(MIN_GIT_FOR_CURLOPT_RESOLVE);
    const g = gitCheck();
    if (!g.ok) return { ok: false, version: null, minimum, cloneEnabled: false, code: 'GIT_MISSING', reason: g.error };
    if (!supportsCurloptResolve(g)) {
      return {
        ok: true, version: g.version, minimum, cloneEnabled: false, code: 'GIT_TOO_OLD',
        reason: `git ${g.version} is installed, but cloning needs ${minimum} or newer: older versions silently ignore the http.curloptResolve setting that pins the host to the addresses that were checked, so the protection against DNS rebinding would be off.`,
      };
    }
    return { ok: true, version: g.version, minimum, cloneEnabled: true };
  }

  const view = (j) => ({
    id: j.id,
    kind: 'clone',
    title: `Clone ${j.display}`,
    url: j.url,
    name: j.slug,
    state: j.state,
    progress: j.progress,
    bytes: j.bytes,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    ...(j.state === 'done' ? { dir: j.dest } : {}),
    ...(j.error ? { error: j.error } : {}),
    ...(j.errorCode ? { code: j.errorCode } : {}),
    private: Boolean(j.private),
    ...(j.viaLogin ? { via: 'login' } : {}),
    ...(j.branch ? { branch: j.branch } : {}),
    log: j.log.slice(-LOG_LIMIT),
  });

  const say = (j, line) => {
    j.log.push(line);
    if (j.log.length > LOG_LIMIT * 2) j.log.splice(0, j.log.length - LOG_LIMIT);
  };

  function prune() {
    const finished = [...jobs.values()].filter((j) => !isLive(j.state)).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    for (const old of finished.slice(KEEP_FINISHED)) jobs.delete(old.id);
  }

  /** Remove the directory THIS job created. Refuses anything that is not a real directory inside the workspace. */
  function removePartial(j) {
    try {
      const st = fs.lstatSync(j.dest);
      if (!st.isDirectory() || st.isSymbolicLink()) return;
      if (contain(getRoot(), j.dest, { mustExist: true }) !== j.dest) return;
      fs.rmSync(j.dest, { recursive: true, force: true, maxRetries: 2 });
    } catch {
      /* nothing to remove, or not ours to remove */
    }
  }

  const killGroup = killGroupOf;

  /** Write (or rewrite) this job's marker. Best effort: a marker that cannot be written must not stop a clone. */
  function writeMarker(j) {
    try {
      fs.writeFileSync(markerPath(getRoot(), j.slug), `${JSON.stringify({ slug: j.slug, url: j.url, dest: j.dest, serverPid: process.pid, gitPid: j.child?.pid ?? null, startedAt: j.startedAt }, null, 2)}\n`);
    } catch { /* see above */ }
  }

  function removeMarker(slug) {
    try { fs.rmSync(markerPath(getRoot(), slug), { force: true }); } catch { /* nothing to remove */ }
  }

  /**
   * Recover ONE marker left by a server that is gone: stop its git if still running, remove the partial directory
   * (only when it is a real directory directly under the workspace root, by contain()), remove the marker.
   * -> {slug, kept:true, why} | {slug, removed:boolean, killed:boolean}
   */
  function recoverOne(file) {
    const root = getRoot();
    let marker;
    try {
      marker = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      try { fs.rmSync(file, { force: true }); } catch { /* not ours to worry about */ }
      return { slug: path.basename(file), removed: false, killed: false, badMarker: true };
    }
    let slug;
    try {
      slug = validateSlug(marker?.slug);
    } catch {
      try { fs.rmSync(file, { force: true }); } catch { /* not ours to worry about */ }
      return { slug: String(marker?.slug ?? ''), removed: false, killed: false, badMarker: true };
    }
    if (path.basename(file) !== path.basename(markerPath(root, slug))) {
      try { fs.rmSync(file, { force: true }); } catch { /* not ours to worry about */ }
      return { slug, removed: false, killed: false, badMarker: true };
    }
    if (reserved.has(slug) || marker.serverPid === process.pid) return { slug, kept: true, why: 'this server is cloning it now' };
    if (!pidIsGone(marker.serverPid)) return { slug, kept: true, why: `server pid ${marker.serverPid} is alive` };
    let dest;
    try {
      dest = contain(root, slug, { mustExist: false });
      if (path.dirname(dest) !== root) throw new WorkspaceError(403, 'OUTSIDE_WORKSPACE', 'not directly under the workspace');
    } catch {
      try { fs.rmSync(file, { force: true }); } catch { /* not ours to worry about */ }
      return { slug, removed: false, killed: false, badMarker: true };
    }
    let killed = false;
    if (isOurGit(marker.gitPid, dest)) {
      try { process.kill(-marker.gitPid, 'SIGKILL'); } catch { try { process.kill(marker.gitPid, 'SIGKILL'); } catch { /* gone */ } }
      killed = true;
    }
    let removed = false;
    try {
      const st = fs.lstatSync(dest);
      if (st.isDirectory() && !st.isSymbolicLink()) {
        fs.rmSync(dest, { recursive: true, force: true, maxRetries: 2 });
        removed = true;
      }
    } catch { /* nothing at the name */ }
    try { fs.rmSync(file, { force: true }); } catch { /* best effort */ }
    return { slug, removed, killed };
  }

  function run(j, args, secret = null) {
    writeMarker(j); // before git exists: a crash from here on leaves a marker, never a bare partial directory
    const redact = makeRedactor(secret?.tokenBuf ?? null);
    const child = spawn('git', args, {
      cwd: getRoot(),
      env: cloneEnv({ allowLocal: Boolean(localRoot), askpass: secret?.askpass?.path ?? null }),
      // Descriptor 3 (only when there is a token) is the pipe the askpass helper reads the password from.
      stdio: secret ? ['ignore', 'ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'pipe'],
      detached: true,
    });
    j.child = child;
    j.recent = [];
    if (secret) liveAskpass.add(secret.askpass);
    if (secret) feedToken(child, Buffer.from(secret.tokenBuf)); // a COPY: written, then zeroed; ours stays for redaction
    liveChildren.add(child);
    installExitHandlers();
    writeMarker(j); // now with git's pid, so a later sweep can stop it if it outlived us
    let ended = false;
    let killReason = null;
    const stop = (reason) => {
      if (killReason || ended) return;
      killReason = reason;
      killGroup(child, 'SIGTERM');
      j.killTimer = setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS);
      j.killTimer.unref?.();
    };
    j.stop = stop;
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const poll = setInterval(() => {
      j.bytes = dirBytes(j.dest, maxBytes);
      if (j.bytes > maxBytes) stop('size');
    }, sizePollMs);
    let last = '';
    let buf = '';
    child.stderr?.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const parts = buf.split(/[\r\n]+/);
      buf = parts.pop() ?? '';
      for (const raw of parts) {
        const line = redact(raw.replace(/[^\x20-\x7e]/g, '')).slice(0, 200).trim();
        if (!line) continue;
        j.recent.push(line);
        if (j.recent.length > 30) j.recent.shift();
        j.progress = line;
        const phase = line.replace(/[\d.]+%.*$/, '').trim();
        if (phase !== last) { last = phase; say(j, line); }
      }
    });
    const finish = (outcome) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      clearInterval(poll);
      clearTimeout(j.killTimer);
      liveChildren.delete(child);
      secret?.askpass?.cleanup(); // the helper script and its private directory go with the job
      if (secret) liveAskpass.delete(secret.askpass);
      removeMarker(j.slug);
      reserved.delete(j.slug);
      j.child = null;
      j.stop = null;
      j.finishedAt = new Date().toISOString();
      if (killReason === 'cancel') {
        removePartial(j);
        j.state = 'cancelled';
        say(j, 'Cancelled. The partial copy was removed.');
      } else if (killReason === 'timeout' || killReason === 'size' || !outcome.ok) {
        removePartial(j);
        j.state = 'failed';
        j.error = killReason === 'timeout'
          ? `The clone took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped. The partial copy was removed.`
          : killReason === 'size'
            ? `The repository is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit and was stopped. The partial copy was removed.`
            : outcome.message;
        const recent = (j.recent ?? []).join('\n');
        if (!killReason && outcome.ok === false && looksLikeAuthFailure(recent)) {
          j.error = j.viaLogin ? NOT_VISIBLE_MESSAGE : j.private ? AUTH_MESSAGE_WITH_TOKEN : AUTH_MESSAGE;
          j.errorCode = j.viaLogin ? NOT_VISIBLE_CODE : 'AUTH';
        }
        say(j, j.error);
      } else {
        const problem = sealClone(j, secret?.tokenBuf ?? null);
        if (problem) {
          removePartial(j);
          j.state = 'failed';
          j.error = problem;
          say(j, problem);
        } else {
          j.bytes = dirBytes(j.dest);
          j.state = 'done';
          j.progress = 'Done';
          say(j, `Cloned into ${j.slug}. origin is ${j.url}.`);
        }
      }
      wipe(secret?.tokenBuf); // our last copy of the token goes when the job is over (after the checks above)
      j.recent = null;
      j.settle?.();
      prune();
    };
    child.once('error', (e) => finish({ ok: false, message: `git could not be started: ${e.code || e.message}` }));
    child.once('close', (code) => finish({ ok: code === 0, message: `git clone failed${j.progress ? `: ${j.progress}` : ''}. Check the address. For a private repository, paste an access token with read access.` }));
  }

  /** Resolve the host and require every address to be public; -> {pin} (null for a local source) or {refusal}. */
  async function resolvePin(parsed) {
    if (parsed.kind !== 'https') return { pin: null };
    let addrs;
    try {
      addrs = (await lookup(parsed.host)).map((a) => a.address);
    } catch {
      return { refusal: { ok: false, status: 502, code: 'HOST_UNRESOLVED', error: `Could not look up ${parsed.host}.` } };
    }
    if (addrs.length === 0 || !addrs.every(isPublicAddress)) {
      return { refusal: { ok: false, status: 403, code: 'HOST_NOT_PUBLIC', error: `${parsed.host} does not resolve to a public internet address, so it will not be cloned from.` } };
    }
    const v4 = addrs.filter((a) => !a.includes(':'));
    const chosen = v4.length ? v4 : addrs.map((a) => `[${a}]`);
    return { pin: `${parsed.host}:443:${chosen.join(',')}` };
  }

  /**
   * #638: may the person's login token be used for this address? Only https on an allowlisted host (checked on the
   * PARSED url, never the raw text). A file:// source exists only in the test harness (`localRoot`) and never asks git
   * for a credential, so the harness can exercise the whole flow with a local repository.
   */
  const loginHostOk = (parsed) => (parsed.kind === 'https' && loginHosts.includes(parsed.host)) || (parsed.kind === 'file' && Boolean(localRoot));

  const LOGIN_HOST_REFUSAL = { ok: false, status: 403, code: 'LOGIN_HOST_NOT_ALLOWED', error: `Your GitHub login can only be used for ${loginHosts.join(', ')} repositories.` };
  const NOT_CONNECTED_REFUSAL = { ok: false, status: 409, code: 'NOT_CONNECTED', error: 'GitHub is not connected (or the connection expired). Connect GitHub for private repositories, or paste an access token.' };

  /** The login token for this request as a Buffer copy the caller must zero, or null. Never throws. */
  async function acquireLogin(sessionKey) {
    try { return loginToken ? await loginToken(String(sessionKey ?? '')) : null; } catch { return null; }
  }

  /** The validated, allowlisted request -> a running job. `holder.buf` is the pasted token as a Buffer or null (the
   * login token, when asked for, is put there once the request has passed every check); `handOff()` tells the caller
   * the job now owns it (and will zero it). */
  async function startInner({ url, name, depth, branch, useLogin, sessionKey }, holder, handOff) {
    let parsed;
    let slug;
    let checkedBranch;
    try {
      parsed = parseCloneUrl(url, { hosts, localRoot });
      slug = name === undefined || name === null || name === '' ? parsed.slug : validateSlug(name);
      checkedBranch = validateBranch(branch);
      if (depth !== undefined && depth !== null && !(Number.isInteger(depth) && depth >= 1 && depth <= MAX_DEPTH)) {
        throw new CloneInputError('BAD_DEPTH', 'depth must be a whole number of 1 or more.');
      }
    } catch (e) {
      if (e instanceof CloneInputError) return { ok: false, status: e.status, code: e.code, error: e.message };
      throw e;
    }
    if (useLogin && !loginHostOk(parsed)) return LOGIN_HOST_REFUSAL;
    const git = gitStatus();
    if (!git.cloneEnabled) return { ok: false, status: 503, code: git.code, error: git.ok ? `Cloning is disabled: ${git.reason}` : `Cloning is unavailable: ${git.reason}` };
    if ([...jobs.values()].some((j) => isLive(j.state))) {
      return { ok: false, status: 409, code: 'BUSY', error: 'Another clone is already running. Wait for it to finish or cancel it.' };
    }
    if (useLogin) {
      holder.buf = await acquireLogin(sessionKey);
      if (!holder.buf) return NOT_CONNECTED_REFUSAL;
    }
    const tokenBuf = holder.buf;
    const resolved = await resolvePin(parsed);
    if (resolved.refusal) return resolved.refusal;
    const { pin } = resolved;
    let dest;
    try {
      dest = contain(getRoot(), slug, { mustExist: false });
      if (path.dirname(dest) !== getRoot()) throw new WorkspaceError(403, 'OUTSIDE_WORKSPACE', 'That folder name is not allowed.');
    } catch (e) {
      if (e instanceof WorkspaceError) return { ok: false, status: e.status === 404 ? 400 : e.status, code: e.code, error: e.message };
      throw e;
    }
    if (reserved.has(slug)) return { ok: false, status: 409, code: 'EXISTS', error: `A folder named "${slug}" is being created right now.` };
    // #422: a retry after a crash. If a previous server died mid-clone of this very slug, its marker says so; recover
    // that one slug now, so the EXISTS check below sees the truth even when the startup sweep did not run.
    if (fs.existsSync(markerPath(getRoot(), slug))) recoverOne(markerPath(getRoot(), slug));
    let taken = true;
    try { fs.lstatSync(dest); } catch { taken = false; } // lstat: a dangling symlink at the name counts as taken
    if (taken) {
      return { ok: false, status: 409, code: 'EXISTS', error: `A folder named "${slug}" already exists in the workspace. Choose another name or open the existing one.` };
    }
    let askpass = null;
    if (tokenBuf) {
      try {
        askpass = createAskpass();
      } catch {
        return { ok: false, status: 500, code: 'ASKPASS_FAILED', error: 'The access token could not be prepared safely, so nothing was cloned.' };
      }
    }
    const j = {
      id: crypto.randomBytes(8).toString('hex'), display: parsed.display, url: parsed.url, slug, dest, private: Boolean(tokenBuf), viaLogin: Boolean(useLogin), branch: checkedBranch,
      state: 'running', progress: 'Starting', bytes: 0, startedAt: new Date().toISOString(), finishedAt: null, error: null, log: [], child: null,
    };
    reserved.add(slug);
    jobs.set(j.id, j);
    say(j, `Cloning ${parsed.url} into ${slug}${checkedBranch ? ` (branch ${checkedBranch})` : ''} (${useLogin ? 'with your GitHub login, used for this clone only and not stored' : tokenBuf ? 'with the access token you pasted, used once and not stored' : 'public repository'}, https only, no hooks, no submodules).`);
    const done = new Promise((r) => { j.settle = r; });
    handOff();
    try {
      run(j, cloneArgs({ parsed, dest, depth: depth ?? null, branch: checkedBranch, pin, allowLocal: Boolean(localRoot) }), tokenBuf ? { tokenBuf, askpass } : null);
    } catch (e) {
      askpass?.cleanup();
      wipe(tokenBuf);
      removeMarker(slug);
      reserved.delete(slug);
      jobs.delete(j.id);
      return { ok: false, status: 500, code: 'SPAWN_FAILED', error: String(e?.message || e) };
    }
    return { ok: true, job: view(j), done };
  }

  /** #638: a pasted token and "use my GitHub login" are two answers to one question; both at once is refused. -> a refusal or null. */
  function authChoice(opts) {
    if (opts.useLogin !== undefined && typeof opts.useLogin !== 'boolean') return { ok: false, status: 400, code: 'BAD_AUTH_CHOICE', error: 'useLogin must be true or false.' };
    const pasted = opts.token !== undefined && opts.token !== null && opts.token !== '';
    if (opts.useLogin && pasted) return { ok: false, status: 400, code: 'BAD_AUTH_CHOICE', error: 'Use either your GitHub login or a pasted access token, not both.' };
    return null;
  }

  // ---- #330 "Pull latest": update a clone WE made, fast-forward only ------------------------------------------------
  const pulling = new Set();

  const pullRefusal = (status, code, error) => ({ ok: false, status, code, error });

  /** Argv for the update: same lockdown as a clone, `pull --ff-only origin` (never a merge commit, never a rebase). */
  function pullArgs({ parsed, pin }) {
    return [
      '-c', 'protocol.allow=never',
      '-c', 'protocol.https.allow=always',
      ...(localRoot && parsed.kind === 'file' ? ['-c', 'protocol.file.allow=always'] : []),
      '-c', 'credential.helper=',
      '-c', 'core.hooksPath=/dev/null',
      '-c', 'core.fsmonitor=false',
      '-c', 'http.followRedirects=false',
      '-c', 'http.proxy=',
      '-c', 'transfer.fsckObjects=true',
      ...(pin ? ['-c', `http.curloptResolve=${pin}`] : []),
      'pull', '--ff-only', '--no-rebase', '--no-recurse-submodules', '--no-edit', 'origin',
    ];
  }

  async function pullInner({ name, useLogin, sessionKey }, holder, handOff) {
    let slug;
    try {
      slug = validateSlug(name);
    } catch (e) {
      if (e instanceof CloneInputError) return pullRefusal(e.status, e.code, e.message);
      throw e;
    }
    let dest;
    try {
      dest = contain(getRoot(), slug, { mustExist: true });
      if (path.dirname(dest) !== getRoot()) throw new WorkspaceError(403, 'OUTSIDE_WORKSPACE', 'That folder is not allowed.');
      const st = fs.lstatSync(dest);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new WorkspaceError(403, 'OUTSIDE_WORKSPACE', 'That folder is not allowed.');
    } catch (e) {
      if (e instanceof WorkspaceError) return pullRefusal(e.status === 404 ? 404 : e.status, e.code, e.status === 404 ? `There is no folder named "${slug}" in the workspace.` : e.message);
      return pullRefusal(404, 'NOT_FOUND', `There is no folder named "${slug}" in the workspace.`);
    }
    if (reserved.has(slug) || pulling.has(slug)) return pullRefusal(409, 'BUSY', `"${slug}" is being cloned or updated right now.`);
    // Only a clone this Cockpit made: its own stamp, naming an address that is still allowed, and an origin that
    // is still exactly that address (a repository someone re-pointed is not one we vouch for).
    let stamp;
    try { stamp = JSON.parse(fs.readFileSync(stampPath(dest), 'utf8')); } catch { stamp = null; }
    let parsed = null;
    try { parsed = stamp && stamp.slug === slug ? parseCloneUrl(stamp.url, { hosts, localRoot }) : null; } catch { parsed = null; }
    if (!parsed) return pullRefusal(403, 'NOT_A_COCKPIT_CLONE', `"${slug}" was not cloned by the Cockpit, so it will not be updated from here.`);
    let origin = null;
    try {
      const m = /\[remote "origin"\][^[]*?\burl\s*=\s*([^\r\n]*)/.exec(fs.readFileSync(path.join(dest, '.git', 'config'), 'utf8'));
      origin = m ? m[1].trim() : null;
    } catch { /* unreadable: treated as changed */ }
    if (origin !== parsed.url) return pullRefusal(409, 'ORIGIN_CHANGED', `The remote of "${slug}" is no longer the address it was cloned from, so it was not updated.`);
    if (useLogin && !loginHostOk(parsed)) return LOGIN_HOST_REFUSAL;
    const gitState = gitStatus();
    if (!gitState.cloneEnabled) return pullRefusal(503, gitState.code, gitState.reason);
    if (useLogin) {
      holder.buf = await acquireLogin(sessionKey);
      if (!holder.buf) return NOT_CONNECTED_REFUSAL;
    }
    const tokenBuf = holder.buf;
    const resolved = await resolvePin(parsed);
    if (resolved.refusal) return resolved.refusal;
    let askpass = null;
    if (tokenBuf) {
      try { askpass = createAskpass(); } catch { return pullRefusal(500, 'ASKPASS_FAILED', 'The access token could not be prepared safely, so nothing was updated.'); }
    }
    pulling.add(slug);
    handOff();
    const redact = makeRedactor(tokenBuf);
    return new Promise((resolve) => {
      let settled = false;
      let out = '';
      let err = '';
      let child;
      let timer;
      const end = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (child) liveChildren.delete(child);
        pulling.delete(slug);
        askpass?.cleanup();
        if (askpass) liveAskpass.delete(askpass);
        wipe(tokenBuf);
        resolve(result);
      };
      try {
        child = spawn('git', pullArgs({ parsed, pin: resolved.pin }), {
          cwd: dest,
          env: cloneEnv({ allowLocal: Boolean(localRoot), askpass: askpass?.path ?? null }),
          stdio: askpass ? ['ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
          detached: true,
        });
      } catch (e) {
        return end(pullRefusal(500, 'SPAWN_FAILED', String(e?.message || e)));
      }
      liveChildren.add(child);
      installExitHandlers();
      if (askpass) liveAskpass.add(askpass);
      if (askpass) feedToken(child, Buffer.from(tokenBuf));
      timer = setTimeout(() => {
        killGroupOf(child, 'SIGKILL');
        end(pullRefusal(504, 'TIMEOUT', `The update took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.`));
      }, timeoutMs);
      child.stdout?.on('data', (c) => { if (out.length < 8192) out += c.toString('utf8'); });
      child.stderr?.on('data', (c) => { if (err.length < 8192) err += c.toString('utf8'); });
      child.once('error', (e) => end(pullRefusal(500, 'SPAWN_FAILED', `git could not be started: ${e.code || e.message}`)));
      child.once('close', (code) => {
        const text = redact(`${out}\n${err}`).replace(/[^\x20-\x7e\n]/g, '');
        if (code === 0) {
          const upToDate = /already up[ -]to[ -]date/i.test(text);
          const detail = text.split('\n').map((l) => l.trim()).filter((l) => /^(Updating|Fast-forward| \d+ files? changed|\d+ files? changed)/.test(l) || /\|/.test(l)).slice(0, 6);
          return end({ ok: true, name: slug, upToDate, message: upToDate ? 'Already up to date.' : 'Updated to the latest.', detail });
        }
        if (looksLikeAuthFailure(text)) return end(useLogin ? pullRefusal(403, NOT_VISIBLE_CODE, NOT_VISIBLE_MESSAGE) : pullRefusal(401, 'AUTH', tokenBuf ? AUTH_MESSAGE_WITH_TOKEN : AUTH_MESSAGE));
        if (/not possible to fast-forward|diverging branches|refusing to merge unrelated/i.test(text)) {
          return end(pullRefusal(409, 'DIVERGED', 'This copy has its own changes that the remote does not have, so it cannot be brought up to date automatically (fast-forward only). Nothing was changed.'));
        }
        if (/would be overwritten|local changes|please commit or stash/i.test(text)) {
          return end(pullRefusal(409, 'DIRTY', 'Uncommitted changes in this folder would be overwritten. Commit or set them aside first. Nothing was changed.'));
        }
        return end(pullRefusal(502, 'PULL_FAILED', 'The update did not work. Check the connection and that the repository still exists.'));
      });
    });
  }

  return {
    /** Validate and start. `token` (optional, a string) is a one-time access token for a private repository: it is
     * validated, held as a Buffer, given to the process only through the per-job askpass helper, and zeroed when the
     * job ends. -> {ok:true, job} | {ok:false, status, code, error} */
    async start(opts = {}) {
      const holder = { buf: null };
      let handed = false;
      const choice = authChoice(opts);
      if (choice) return choice;
      try {
        holder.buf = parseToken(opts.token);
      } catch (e) {
        if (e instanceof CloneInputError) return { ok: false, status: e.status, code: e.code, error: e.message };
        throw e;
      }
      try {
        return await startInner(opts, holder, () => { handed = true; });
      } finally {
        if (!handed) wipe(holder.buf);
      }
    },
    /**
     * #422: sweep the workspace for markers left by a server that is gone (called at server start, and usable any
     * time). Removes only directories that carry OUR marker, are real directories, and sit directly under the
     * workspace root; stops an orphaned git first when it is still running. A marker whose server is alive is kept.
     * -> {removed: string[], killed: string[], kept: {slug, why}[], badMarkers: string[]}
     */
    recoverInterrupted() {
      const out = { removed: [], killed: [], kept: [], badMarkers: [] };
      let names = [];
      try { names = fs.readdirSync(getRoot()); } catch { return out; }
      for (const name of names) {
        if (!name.startsWith(MARKER_PREFIX) || !name.endsWith('.json')) continue;
        const r = recoverOne(path.join(getRoot(), name));
        if (r.badMarker) out.badMarkers.push(name);
        else if (r.kept) out.kept.push({ slug: r.slug, why: r.why });
        else {
          if (r.removed) out.removed.push(r.slug);
          if (r.killed) out.killed.push(r.slug);
        }
      }
      return out;
    },
    /** "Pull latest" for a clone this Cockpit made: `git pull --ff-only`, argv only, contained, with the same one-time
     * `token` handling as start(). -> {ok:true, name, upToDate, message, detail} | {ok:false, status, code, error} */
    async pull(opts = {}) {
      const holder = { buf: null };
      let handed = false;
      const choice = authChoice(opts);
      if (choice) return choice;
      try {
        holder.buf = parseToken(opts.token);
      } catch (e) {
        if (e instanceof CloneInputError) return { ok: false, status: e.status, code: e.code, error: e.message };
        throw e;
      }
      try {
        return await pullInner(opts, holder, () => { handed = true; });
      } finally {
        if (!handed) wipe(holder.buf);
      }
    },
    gitStatus,
    list: () => [...jobs.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).map(view),
    get(id) {
      const j = typeof id === 'string' ? jobs.get(id) : undefined;
      return j ? view(j) : null;
    },
    /** -> {status, body} */
    cancel(id) {
      const j = typeof id === 'string' ? jobs.get(id) : undefined;
      if (!j) return { status: 404, body: { ok: false, error: 'No such clone.' } };
      if (j.state !== 'running') return { status: 409, body: { ok: false, error: `A clone that is ${j.state} cannot be cancelled.`, job: view(j) } };
      j.state = 'cancelling';
      j.stop?.('cancel');
      return { status: 200, body: { ok: true, job: view(j) } };
    },
    /** Test seam: resolves when the given job has finished. */
    live: () => [...jobs.values()].filter((j) => isLive(j.state)).length,
  };
}
