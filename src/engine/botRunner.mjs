// #291 — the bot runner: the `executeStep` #287's engine is waiting for.
//
// One seam, nothing else: `createBotRunner().executeStep` has exactly the
// signature `createProcessEngine({ executeStep })` calls. The engine owns
// *when* a step runs, pause/cancel and recording; this file owns *how*.
//
// Decisions settled by the owner on #291:
//  1. Each bot runs in its OWN git worktree, so parallel bots never share a
//     tree. One worktree per *process* (a process is one bot): its steps run
//     in order in that worktree and every step that succeeds becomes a git
//     commit on the branch `construct/bot/<processId>`.
//  2. A failed step stops the plan (the engine does that on `ok:false`). The
//     runner's part: the failed step's half-written files are reset to the
//     last commit, and the steps that already committed stay committed.
//
// The approval gate (safety property): a bot writes ONLY inside its worktree.
// This executor deliberately never uses the `transaction` the engine hands it
// — committing that transaction would write into the user's tree. Results
// leave as `artifacts` (unapproved; the process model records
// `approved: null`), and the content itself lives on the bot's branch until
// the approval gate applies it. Cancel and failure therefore leave the user's
// working tree byte-identical.
//
// Provenance: a `deterministic` step runs with no model reachable (no `--llm`
// flag is tolerated and the model-related environment is stripped) and reports
// `llm: null`. A `local-model` step reports `{ provider, calls }`. `user`
// steps never reach the executor — the engine pauses the process for them.
//
// Cleanup survives a killed server: the worktree directory name carries the
// owner's pid, and `reclaimDead()` removes worktrees whose owner is gone,
// conservatively (a live pid, EPERM or an unparseable name is left alone) — the
// pattern of test-utils/tmpdir.mjs (#254). The branch is kept: it holds the
// committed steps the owner still has to review.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { resolveStateDir } from './processStore.mjs';
import { StepAborted } from './processEngine.mjs';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'construct.mjs');
const GIT_IDENTITY = ['-c', 'user.name=Construct Bot', '-c', 'user.email=bot@construct.invalid', '-c', 'commit.gpgsign=false'];
const MODEL_ENV = ['OLLAMA_HOST', 'OLLAMA_MODEL', 'CONSTRUCT_OLLAMA_URL', 'CONSTRUCT_OLLAMA_MODEL', 'ANTHROPIC_API_KEY'];
const DEFAULT_MAX_CONCURRENT = 1;

/** Configured concurrency: an explicit option, else CONSTRUCT_BOT_CONCURRENCY,
 * else 1 (this box is 15 GB with no swap). Never below 1. */
export function resolveMaxConcurrent(explicit, env = process.env) {
  const raw = explicit ?? env.CONSTRUCT_BOT_CONCURRENCY;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX_CONCURRENT;
}

export const botBranch = (processId) => `construct/bot/${String(processId).replace(/[^A-Za-z0-9._-]/g, '_')}`;

// #413: bounded like every synchronous git call in core (see gitTrees.GIT_TIMEOUT_MS); a hung git must not hang a bot.
const GIT_TIMEOUT_MS = 10 * 60 * 1000;

function git(cwd, args, { input } = {}) {
  const res = spawnSync('git', [...GIT_IDENTITY, ...args], { cwd, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024, timeout: GIT_TIMEOUT_MS, killSignal: 'SIGKILL' });
  const err = /** @type {any} */ (res.error)?.code === 'ETIMEDOUT'
    ? `git ${args[0]} did not finish within ${Math.round(GIT_TIMEOUT_MS / 1000)} seconds and was stopped.`
    : (res.stderr || res.error?.message || '').trim();
  return { ok: res.status === 0, out: res.stdout ?? '', err };
}

/** True unless the pid is provably dead. Conservative on purpose. */
function ownerIsDead(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return err.code === 'ESRCH';
  }
}

const readIfExists = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};

/**
 * @param {object} [options]
 * @param {string} [options.stateDir]       where worktrees live (`<stateDir>/worktrees`)
 * @param {number} [options.maxConcurrent]  see resolveMaxConcurrent(); hand `runner.maxConcurrent` to the engine
 * @param {string} [options.bin]            the construct entry point to spawn
 * @param {string[]} [options.nodeArgs]     extra node args
 */
export function createBotRunner({ stateDir = resolveStateDir(), maxConcurrent, bin = BIN, nodeArgs = [], env = process.env } = {}) {
  const root = path.join(stateDir, 'worktrees');
  /** processId -> { dir, repo, branch, projectDir } */
  const bots = new Map();
  const dirNameFor = (processId) => `${process.pid}-${String(processId).replace(/[^A-Za-z0-9._-]/g, '_')}`;

  /** Remove worktree directories whose owning pid is dead. Returns what it reclaimed. */
  function reclaimDead() {
    const reclaimed = [];
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return reclaimed; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pid = Number.parseInt(entry.name.split('-')[0], 10);
      if (!ownerIsDead(pid)) continue; // live, EPERM, unparseable, or us: not ours to remove
      const dir = path.join(root, entry.name);
      const sidecar = `${dir}.json`;
      let meta = null;
      try { meta = JSON.parse(fs.readFileSync(sidecar, 'utf8')); } catch { /* no sidecar: still remove the dir */ }
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { continue; }
      try { fs.rmSync(sidecar, { force: true }); } catch { /* best effort */ }
      if (meta?.repo && fs.existsSync(meta.repo)) git(meta.repo, ['worktree', 'prune']);
      reclaimed.push(entry.name);
    }
    return reclaimed;
  }

  /** The bot's worktree, created on its first step. Reuses the process's
   * branch when it exists, so a resumed process (new server, new pid) keeps
   * the steps an earlier bot already committed. */
  function ensureBot(processId, projectRoot) {
    const existing = bots.get(processId);
    if (existing) return existing;
    reclaimDead();
    const top = git(projectRoot, ['rev-parse', '--show-toplevel']);
    if (!top.ok) throw new Error(`Bots run in a git worktree, so ${projectRoot} must be inside a git repository (${top.err}).`);
    const repo = fs.realpathSync(top.out.trim());
    const rel = path.relative(repo, fs.realpathSync(projectRoot));
    const branch = botBranch(processId);
    const dir = path.join(root, dirNameFor(processId));
    fs.mkdirSync(root, { recursive: true });
    const hasBranch = git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
    const added = hasBranch
      ? git(repo, ['worktree', 'add', dir, branch])
      : git(repo, ['worktree', 'add', '-b', branch, dir, 'HEAD']);
    if (!added.ok) throw new Error(`Could not create the bot's worktree: ${added.err}`);
    fs.writeFileSync(`${dir}.json`, `${JSON.stringify({ repo, branch, processId, pid: process.pid })}\n`);
    const bot = { dir, repo, branch, projectDir: path.join(dir, rel) };
    bots.set(processId, bot);
    return bot;
  }

  /** Put the worktree back at its last commit: a failed or cancelled step
   * leaves nothing behind for the next one to trip over. */
  function resetBot(bot) {
    git(bot.dir, ['reset', '--hard', 'HEAD']);
    git(bot.dir, ['clean', '-fdq']);
  }

  /** What the step changed, read from the worktree, relative to the project. */
  function collectChanges(bot) {
    const status = git(bot.dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const artifacts = [];
    const rels = status.out.split('\0').filter(Boolean);
    for (let i = 0; i < rels.length; i += 1) {
      const code = rels[i].slice(0, 2);
      const file = rels[i].slice(3);
      if (code[0] === 'R') i += 1; // rename: next field is the origin; the new path is what changed
      const inProject = path.relative(bot.projectDir, path.join(bot.dir, file));
      if (inProject.startsWith('..')) continue;
      const beforeRes = git(bot.dir, ['show', `HEAD:${file}`]);
      const before = beforeRes.ok ? beforeRes.out : null;
      const after = readIfExists(path.join(bot.dir, file));
      artifacts.push({
        path: inProject.split(path.sep).join('/'),
        change: after === null ? 'delete' : before === null ? 'create' : 'modify',
        before,
        after,
      });
    }
    return artifacts;
  }

  function runChild(argv, { cwd, stdin, signal, childEnv, log }) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [...nodeArgs, bin, ...argv], { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const cap = (s, chunk) => (s + chunk).slice(-64 * 1024);
      const onAbort = () => child.kill('SIGKILL');
      if (signal.aborted) onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', (c) => { out = cap(out, c); });
      child.stderr.on('data', (c) => { err = cap(err, c); });
      child.on('error', (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
      child.on('close', (code) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) return reject(new StepAborted('(in flight)'));
        log('ok', `exit ${code}`, { stdout: out.trim().slice(-2000), stderr: err.trim().slice(-2000) });
        resolve({ code, out, err });
      });
      child.stdin.on('error', () => { /* child exited before reading stdin */ });
      child.stdin.end(stdin ?? '');
    });
  }

  /** The #287 seam. See the file header. */
  async function executeStep({ process: proc, step, command, signal, log }) {
    const isModel = step.executor === 'local-model';
    const provider = step.args?.llm ?? null;
    const noModel = { ok: false, llm: null };
    if (!isModel && provider) {
      return { ...noModel, error: `Step "${step.id}" is deterministic but asks for a model (--llm ${provider}); refusing to run it with one.` };
    }
    if (command.manual || !command.argv) {
      return { ...noModel, error: `Step "${step.id}" is a manual step and cannot be run by a bot.` };
    }

    const bot = ensureBot(proc.id, proc.projectRoot);
    if (step.args?.dir) {
      const target = path.resolve(bot.projectDir, step.args.dir);
      if (target !== bot.dir && !target.startsWith(bot.dir + path.sep)) {
        return { ...noModel, error: `Step "${step.id}" targets ${step.args.dir}, which is outside the bot's worktree; refusing.` };
      }
    }
    const childEnv = { ...env };
    if (!isModel) for (const k of MODEL_ENV) delete childEnv[k];

    let res;
    try {
      res = await runChild(command.argv, {
        cwd: bot.projectDir, stdin: command.stdin, signal, childEnv, log,
      });
    } catch (e) {
      resetBot(bot);
      if (e instanceof StepAborted) throw new StepAborted(step.id);
      return { ok: false, llm: isModel ? { provider, calls: 0 } : null, error: e.message };
    }

    const llm = isModel ? { provider, calls: 1 } : null;
    if (res.code !== 0) {
      resetBot(bot);
      const detail = (res.err || res.out).trim().split('\n').slice(-6).join('\n');
      return { ok: false, llm, error: `construct ${command.argv.slice(0, 2).join(' ')} exited with status ${res.code}${detail ? `: ${detail}` : ''}` };
    }

    const artifacts = collectChanges(bot);
    if (artifacts.length) {
      git(bot.dir, ['add', '-A']);
      const committed = git(bot.dir, ['commit', '-q', '-m', `${step.id}: ${step.title}`]);
      if (!committed.ok) {
        resetBot(bot);
        return { ok: false, llm, error: `Could not commit the step in its worktree: ${committed.err}` };
      }
    }
    log(isModel ? 'llm' : 'ok', `${artifacts.length} file(s) changed in the bot's worktree (branch ${bot.branch}); the project is untouched until you approve.`);
    return { ok: true, llm, artifacts };
  }

  /** Remove a bot's worktree directory (the branch, and so its committed
   * steps, is kept for review). Call when a process reaches a terminal state
   * and its artifacts have been dealt with. */
  function release(processId) {
    const bot = bots.get(processId);
    if (!bot) return false;
    bots.delete(processId);
    git(bot.repo, ['worktree', 'remove', '--force', bot.dir]);
    try { fs.rmSync(bot.dir, { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(`${bot.dir}.json`, { force: true }); } catch { /* best effort */ }
    git(bot.repo, ['worktree', 'prune']);
    return true;
  }

  return {
    executeStep,
    reclaimDead,
    release,
    maxConcurrent: resolveMaxConcurrent(maxConcurrent, env),
    worktreeRoot: root,
    /** The worktree a process's bot is using, or null. */
    worktreeOf: (processId) => bots.get(processId)?.dir ?? null,
  };
}
