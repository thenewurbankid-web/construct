// Read-only git access for PR health (#314/#316): resolve refs, list changed files, and read the
// tree at a commit — without ever touching the user's working tree, index, branch or stash.
//
// SAFETY MODEL (the reason this file exists rather than inline `git` calls):
//   * argv arrays only, `shell: false`, always — a ref or path can never be interpreted by a shell.
//   * caller-supplied refs are validated (no leading `-`, no NUL/CR/LF, bounded length), resolved with
//     `git rev-parse --verify --end-of-options <ref>^{commit}`, and from then on only the resulting
//     hex object id is used, so no later command can be handed an option-shaped string.
//   * every git call gets `--literal-pathspecs`, `--no-optional-locks` (a read never refreshes the
//     index), and a `--` before any path.
//   * the tree at a commit is read from a `git worktree add --detach` checkout in a per-process
//     directory under os.tmpdir(), with hooks and LFS filters disabled so nothing in the user's repo
//     config can run code or reach the network during the checkout. The checkout is removed in a
//     `finally`, and on process exit / SIGINT / SIGTERM if the process dies mid-run, so the user's
//     `git worktree list` is byte-identical afterwards. Debris from a run that was SIGKILLed (which no
//     handler can observe) is reclaimed by the next run, only for our own `construct-prhealth-<pid>-`
//     directories whose pid is dead.
//   * The user's checkout, HEAD, branches and stash are never written.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT_PREFIX = 'construct-prhealth-';
const MAX_REF_LENGTH = 256;
const HEX_ID = /^[0-9a-f]{40,64}$/;
const GIT_ENV_STRIP = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX', 'GIT_CEILING_DIRECTORIES'];
const err = (code, message) => ({ ok: false, error: { code, message } });

function gitEnv() {
  const env = { ...process.env };
  for (const k of GIT_ENV_STRIP) delete env[k];
  return { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
}

// #413: every synchronous git call is bounded. A local git call that takes this long is stuck (a lock nobody
// releases, a prompt GIT_TERMINAL_PROMPT=0 did not cover, a filter hanging), and a stuck spawnSync blocks the
// whole event loop of whoever called it. Killed outright: SIGTERM can be ignored, SIGKILL cannot.
export const GIT_TIMEOUT_MS = 10 * 60 * 1000;

/** Run git with an argv array. Never a shell. Returns `{status, stdout, stderr}`. */
export function git(cwd, args, { config = [], maxBuffer = 256 * 1024 * 1024, timeout = GIT_TIMEOUT_MS } = {}) {
  const argv = ['--literal-pathspecs', '--no-optional-locks', ...config.flatMap((c) => ['-c', c]), ...args];
  const r = spawnSync('git', argv, { cwd, encoding: 'utf8', shell: false, env: gitEnv(), maxBuffer, timeout, killSignal: 'SIGKILL' });
  if (/** @type {any} */ (r.error)?.code === 'ETIMEDOUT') return { status: -1, stdout: '', stderr: `git ${args[0]} did not finish within ${Math.round(timeout / 1000)} seconds and was stopped.` };
  if (r.error) return { status: -1, stdout: '', stderr: String(r.error.message || r.error) };
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** Validate a caller-supplied ref and resolve it to a commit id. Never throws. */
export function resolveCommit(cwd, label, ref) {
  if (typeof ref !== 'string' || !ref.trim()) return err('INVALID_ARGUMENT', `${label} must be a non-empty git ref (a branch, tag or commit).`);
  if (ref.startsWith('-')) return err('INVALID_ARGUMENT', `${label} "${ref}" is not a valid ref: refs cannot start with "-".`);
  if (/[\0\r\n]/.test(ref) || ref.length > MAX_REF_LENGTH) return err('INVALID_ARGUMENT', `${label} is not a valid ref.`);
  const r = git(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  const sha = r.stdout.trim();
  if (r.status !== 0 || !HEX_ID.test(sha)) return err('REF_NOT_FOUND', `${label} "${ref}" is not a commit in this repository.`);
  return { ok: true, sha };
}

/** `{top, prefix}`: the repo's top-level dir and the project root's path inside it ('' or 'a/b/'). */
export function repoInfo(cwd) {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return err('NOT_A_GIT_REPO', `${cwd} is not inside a git repository.`);
  const prefix = git(cwd, ['rev-parse', '--show-prefix']);
  return { ok: true, top: fs.realpathSync(top.stdout.trim()), prefix: prefix.stdout.trim() };
}

/** The merge base of two commits, or null when their histories are unrelated. */
export function mergeBase(cwd, a, b) {
  const r = git(cwd, ['merge-base', a, b]);
  const sha = r.stdout.trim();
  return r.status === 0 && HEX_ID.test(sha) ? sha : null;
}

/** Files changed between two commits under the project root, as `{path, status}` (A/M/D/T), paths
 * relative to the project root. Renames are reported as a delete plus an add, so the list is stable. */
export function changedFiles(cwd, baseSha, headSha) {
  const r = git(cwd, ['diff', '--name-status', '-z', '--no-renames', '--relative', baseSha, headSha, '--']);
  if (r.status !== 0) return err('GIT_FAILED', `git diff failed: ${r.stderr.trim() || 'unknown error'}`);
  const parts = r.stdout.split('\0').filter((s) => s !== '');
  const files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) files.push({ status: parts[i][0], path: parts[i + 1] });
  return { ok: true, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

// ---- temporary checkouts ------------------------------------------------------------------------

const live = new Set(); // { dir, repo } checkouts this process has registered and not yet removed
let root = null;
let handlersInstalled = false;

const isRegistered = (repo, dir) => git(repo, ['worktree', 'list', '--porcelain']).stdout.split('\n').some((l) => l === `worktree ${dir}`);

function removeOne(entry) {
  const { dir, repo } = entry;
  git(repo, ['worktree', 'remove', '--force', dir]);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ }
  // If the directory vanished first, git still remembers it; dropping registrations whose directory
  // is gone is the only way to forget it.
  if (isRegistered(repo, dir)) git(repo, ['worktree', 'prune']);
  live.delete(entry);
}

function dropRoot() {
  if (!root) return;
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ }
  root = null;
}

function cleanupAll() {
  for (const entry of [...live]) removeOne(entry);
  dropRoot();
}

function installHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('exit', cleanupAll);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => {
      cleanupAll();
      process.removeListener(signal, handler);
      process.kill(process.pid, signal);
    };
    process.on(signal, handler);
  }
}

/** Reclaim debris left by a process that was SIGKILLed/OOM-killed: our own dirs, dead pids only. */
function sweepDeadRoots(tmp, repo) {
  let entries;
  try { entries = fs.readdirSync(tmp, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith(ROOT_PREFIX)) continue;
    const pid = Number.parseInt(e.name.slice(ROOT_PREFIX.length).split('-')[0], 10);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    try { process.kill(pid, 0); continue; } catch (x) { if (x.code !== 'ESRCH') continue; }
    const dir = path.join(tmp, e.name);
    const stale = git(repo, ['worktree', 'list', '--porcelain']).stdout.split('\n').some((l) => l.startsWith(`worktree ${dir}`));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* not ours to worry about */ }
    if (stale) git(repo, ['worktree', 'prune']);
  }
}

/**
 * #351 -- remove exactly what ONE other process left behind: its `construct-prhealth-<pid>-*` directory
 * and the `git worktree` registrations under it. Used by whoever stopped that process (a cancelled
 * analysis whose worker had to be killed before its own cleanup could run). Surgical: only that pid's
 * directory is touched, and `worktree prune` runs only if a registration under it is still listed.
 * Refuses our own pid and a pid that is still alive. Returns what it removed, for the caller to verify.
 */
export function reclaimTreesOf(pid, cwd) {
  const removed = [];
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return removed;
  try { process.kill(pid, 0); return removed; } catch (x) { if (x.code !== 'ESRCH') return removed; }
  const info = repoInfo(cwd);
  const tmp = fs.realpathSync(os.tmpdir());
  let entries = [];
  try { entries = fs.readdirSync(tmp, { withFileTypes: true }); } catch { /* nothing to reclaim */ }
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith(`${ROOT_PREFIX}${pid}-`)) continue;
    const dir = path.join(tmp, e.name);
    const registered = () => info.ok && git(info.top, ['worktree', 'list', '--porcelain']).stdout.split('\n').some((l) => l.startsWith(`worktree ${dir}`));
    if (info.ok && registered()) {
      for (const l of git(info.top, ['worktree', 'list', '--porcelain']).stdout.split('\n')) {
        if (l.startsWith(`worktree ${dir}`)) git(info.top, ['worktree', 'remove', '--force', l.slice('worktree '.length)]);
      }
    }
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ }
    if (registered()) git(info.top, ['worktree', 'prune']);
    removed.push(dir);
  }
  return removed;
}

function tempRoot(repo) {
  if (!root) {
    const tmp = fs.realpathSync(os.tmpdir());
    sweepDeadRoots(tmp, repo);
    root = fs.realpathSync(fs.mkdtempSync(path.join(tmp, `${ROOT_PREFIX}${process.pid}-`)));
    installHandlers();
  }
  return root;
}

const CHECKOUT_CONFIG = [`core.hooksPath=${os.devNull}`, 'filter.lfs.smudge=', 'filter.lfs.process=', 'filter.lfs.required=false', 'core.fsmonitor=false'];

/**
 * Check out each commit id into its own temporary detached worktree, run `fn(dirs)` (dirs[i] is the
 * repo top-level of shas[i]), and ALWAYS remove them again — on return, on throw, and on process
 * exit. `fn` must only read. Returns `fn`'s result, or `{ok:false,error}` if a checkout failed.
 */
export function withTrees(cwd, shas, fn) {
  const info = repoInfo(cwd);
  if (!info.ok) return info;
  const repo = info.top;
  const mine = [];
  try {
    const base = tempRoot(repo);
    for (const [i, sha] of shas.entries()) {
      if (!HEX_ID.test(sha)) return err('INVALID_ARGUMENT', 'Internal: a commit id was expected.');
      const dir = path.join(base, `tree-${i}-${sha.slice(0, 12)}`);
      const entry = { dir, repo };
      live.add(entry);
      mine.push(entry);
      const r = git(repo, ['worktree', 'add', '--detach', '--quiet', dir, sha], { config: CHECKOUT_CONFIG });
      if (r.status !== 0) return err('CHECKOUT_FAILED', `Could not read ${sha.slice(0, 12)} into a temporary directory: ${r.stderr.trim() || 'git worktree add failed'}`);
    }
    return fn(mine.map((e) => e.dir), info);
  } finally {
    for (const entry of mine) removeOne(entry);
    if (!live.size) dropRoot();
  }
}

/** For tests: how many temporary checkouts this process currently holds. */
export const liveTreeCount = () => live.size;
