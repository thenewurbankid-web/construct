// #416 -- `construct process gc`: the sweep nothing else runs on its own.
//
// Three kinds of debris an interrupted Cockpit session or an abandoned review leaves behind, and where each one
// is checked:
//   (a) dead-owner worktree directories under `<stateDir>/worktrees` -- `botRunner.mjs`'s own `reclaimDead()`
//       already knows how to find and remove these, but today it only runs inside `ensureBot()`, i.e. when the
//       NEXT bot starts. This block runs it on demand, with nothing else needing to start first.
//   (b) `construct/bot/<id>` branches whose process is terminal (done/failed/cancelled) and fully decided (every
//       artifact has a verdict) -- exactly the rule `approvalGate.mjs`'s `settle()` uses to decide whether IT may
//       delete a branch (#337 rule 8), applied here for branches `settle()` never got to see: the process reached
//       a terminal state while paused with artifacts still undecided, or the server restarted before `settle()`
//       ran for it. A branch whose process record is simply gone (removed by `prune()`, or from a project moved
//       or reset) is treated the same way: nothing can ever decide it now, so it is orphaned by definition.
//   (c) process records older than a threshold that still have an artifact with no verdict -- these are FLAGGED
//       ONLY, never deleted: an undecided approval is a human's decision still pending, not garbage.
//
// JSON in / JSON out, exactly the "small, deterministic, non-LLM block" the project's own charter asks for
// (README's "Vision"): no model is involved, and `dryRun` makes every side effect optional so the same function
// is both the report the server shows at start-up and the `--dry-run` the CLI offers.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openProcessStore, resolveStateDir } from './processStore.mjs';
import { createBotRunner, botBranch } from './botRunner.mjs';
import { topLevelState } from './processMachine.mjs';

const DEFAULT_OLDER_THAN_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BOT_BRANCH_PREFIX = botBranch('');
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

// #413: bounded like every synchronous git call in the engine (see gitTrees.GIT_TIMEOUT_MS) -- a hung git must
// never hang gc.
const GIT_TIMEOUT_MS = 10 * 60 * 1000;

function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, killSignal: 'SIGKILL' });
  const err = /** @type {any} */ (res.error)?.code === 'ETIMEDOUT'
    ? `git ${args[0]} did not finish within ${Math.round(GIT_TIMEOUT_MS / 1000)} seconds and was stopped.`
    : (res.stderr || res.error?.message || '').trim();
  return { ok: res.status === 0, out: res.stdout ?? '', err };
}

/** The same "fully decided" test `approvalGate.mjs`'s `settle()` applies before it will delete a branch (#337
 * rule 8): every recorded artifact has a verdict, approved or rejected. A process with no artifacts at all
 * (never wrote anything) counts as decided -- there is nothing left to decide. */
function isFullyDecided(record) {
  return Array.isArray(record?.artifacts) && record.artifacts.every((a) => a.approved !== null);
}

/**
 * `construct process gc` (#416): report (and, unless `dryRun`, clean up) the process-runtime debris that
 * accumulates outside any single process record: dead-owner bot worktrees, orphaned `construct/bot/*` branches,
 * and old records with an approval still pending (listed, never touched).
 *
 * @param {string} projectRoot The project whose bot branches and process records are checked. Worktree cleanup
 *   (a) is global to the state directory, exactly like `botRunner.mjs`'s own `reclaimDead()` -- a worktree
 *   belongs to whichever project's sidecar file names as its `repo`, not necessarily this one.
 * @param {object} [options]
 * @param {string} [options.stateDir] Base state directory (defaults to `resolveStateDir()`).
 * @param {boolean} [options.dryRun] List everything found without deleting or removing anything.
 * @param {number} [options.olderThanDays] Age threshold, in days, for flagging a stale pending-approval record.
 * @param {() => Date} [options.now] Clock, for tests.
 * @returns {{
 *   ok: boolean,
 *   dryRun?: boolean,
 *   worktrees?: {found: string[], removed: string[]},
 *   branches?: {found: {branch:string, processId:string, reason:string}[], removed: string[]},
 *   staleApprovals?: {id:string, createdAt:string, ageDays:number, pending:string[]}[],
 *   counts?: {worktrees:number, branches:number, staleApprovals:number},
 *   error?: {code:string, message:string},
 * }} `counts` always reflects what THIS run actually did: `found.length` when `dryRun`, `removed.length`
 *   otherwise (staleApprovals are only ever listed, so its count is the same either way).
 *
 * @example
 * gcProcesses('/work/web', { dryRun: true }).counts; // => { worktrees: 1, branches: 0, staleApprovals: 2 }
 */
export function gcProcesses(projectRoot, { stateDir = resolveStateDir(), dryRun = false, olderThanDays = DEFAULT_OLDER_THAN_DAYS, now = () => new Date() } = {}) {
  const root = path.resolve(projectRoot);
  let rootReal;
  try { rootReal = fs.realpathSync(root); } catch { return { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: `${root} does not exist.` } }; }
  const top = git(rootReal, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return { ok: false, error: { code: 'NOT_A_REPO', message: `${root} is not inside a git repository (${top.err}).` } };
  const gitRoot = fs.realpathSync(top.out.trim());

  // (a) dead-owner worktree directories under <stateDir>/worktrees.
  const runner = createBotRunner({ stateDir });
  const worktreesFound = runner.reclaimDead({ dryRun: true });
  const worktreesRemoved = dryRun ? [] : runner.reclaimDead();

  // (b) construct/bot/* branches: terminal + fully decided, or the record is gone entirely.
  const store = openProcessStore(root, { stateDir });
  const { processes } = store.all();
  const byId = new Map(processes.map((p) => [p.id, p]));
  const branchList = git(gitRoot, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${BOT_BRANCH_PREFIX}`]);
  const branchNames = branchList.ok ? branchList.out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const branchesFound = [];
  for (const branch of branchNames) {
    const processId = branch.slice(BOT_BRANCH_PREFIX.length);
    const record = byId.get(processId);
    const reason = !record
      ? 'no matching process record'
      : (TERMINAL.has(topLevelState(record.state)) && isFullyDecided(record))
        ? 'terminal and fully decided'
        : null;
    if (reason) branchesFound.push({ branch, processId, reason });
  }
  const branchesRemoved = [];
  if (!dryRun) {
    for (const { branch } of branchesFound) {
      if (git(gitRoot, ['branch', '-D', branch]).ok) branchesRemoved.push(branch);
    }
  }

  // (c) records older than the threshold with a pending approval: LISTED, never deleted -- a human's decision.
  const cutoff = now().getTime() - Math.max(0, olderThanDays) * MS_PER_DAY;
  const staleApprovals = processes
    .filter((p) => Array.isArray(p.artifacts) && p.artifacts.some((a) => a.approved === null) && Date.parse(p.createdAt) < cutoff)
    .map((p) => ({
      id: p.id,
      createdAt: p.createdAt,
      ageDays: Math.floor((now().getTime() - Date.parse(p.createdAt)) / MS_PER_DAY),
      pending: p.artifacts.filter((a) => a.approved === null).map((a) => a.path),
    }));

  return {
    ok: true,
    dryRun,
    worktrees: { found: worktreesFound, removed: worktreesRemoved },
    branches: { found: branchesFound, removed: branchesRemoved },
    staleApprovals,
    counts: {
      worktrees: dryRun ? worktreesFound.length : worktreesRemoved.length,
      branches: dryRun ? branchesFound.length : branchesRemoved.length,
      staleApprovals: staleApprovals.length,
    },
  };
}
