// #416 -- `construct process gc` on a fixture repo, one of each orphan kind: a dead-owner bot worktree, a
// `construct/bot/*` branch that is terminal and fully decided (or whose record is simply gone), and an old
// record that still has an approval pending -- listed, never deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createProcess, recordArtifact, setApproval } from '../packages/engine/processModel.mjs';
import { openProcessStore } from '../packages/engine/processStore.mjs';
import { gcProcesses } from '../packages/engine/processGc.mjs';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'];
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const gitOut = (cwd, ...args) => git(cwd, ...args).stdout;
const deadPid = () => Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
const DAY = 24 * 60 * 60 * 1000;

const PLAN = {
  version: 1,
  ticket: { source: 'text', title: 'Add totals' },
  steps: [{ id: 'a', title: 'Create the feature', flow: 'create.feature', args: { name: 'checkout' }, executor: 'deterministic', touches: { features: ['checkout'], files: [] } }],
};

function repo() {
  const dir = makeTempDir('construct-gc-project-');
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hi\n');
  git(dir, 'add', '-A');
  git(dir, ...ID, 'commit', '-q', '-m', 'init');
  return fs.realpathSync(dir);
}

/** A dead-owner worktree directory + its sidecar, the exact shape `botRunner.mjs`'s `ensureBot()` writes. */
function makeWorktreeOrphan(stateDir, { repoDir, processId, pid }) {
  const root = path.join(stateDir, 'worktrees');
  fs.mkdirSync(root, { recursive: true });
  const name = `${pid}-${processId}`;
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'x'), 'x');
  fs.writeFileSync(`${dir}.json`, JSON.stringify({ repo: repoDir, branch: `construct/bot/${processId}`, processId, pid }));
  return name;
}

/** A process record with one artifact, fully decided (approved). */
function decidedRecord(store, { id, state, now }) {
  let rec = createProcess(PLAN, { id, projectRoot: store.projectRoot, now });
  rec = recordArtifact(rec, { path: 'features/checkout/index.ts', change: 'create', stepId: 'a', now });
  rec = setApproval(rec, true);
  return store.save({ ...rec, state });
}

/** A process record with one artifact still awaiting a verdict. */
function pendingRecord(store, { id, state, now }) {
  let rec = createProcess(PLAN, { id, projectRoot: store.projectRoot, now });
  rec = recordArtifact(rec, { path: 'features/checkout/index.ts', change: 'create', stepId: 'a', now });
  return store.save({ ...rec, state });
}

test('lists one of each orphan kind on a fixture repo; --dry-run touches nothing', () => {
  const projectRoot = repo();
  const stateDir = makeTempDir('construct-gc-state-');
  const store = openProcessStore(projectRoot, { stateDir });
  const dead = deadPid();
  const nowIso = () => new Date().toISOString();

  const wtName = makeWorktreeOrphan(stateDir, { repoDir: projectRoot, processId: 'orphanproc', pid: dead });

  for (const b of ['p-done', 'p-ghost', 'p-pending', 'p-live']) git(projectRoot, 'branch', `construct/bot/${b}`);
  decidedRecord(store, { id: 'p-done', state: 'done', now: nowIso }); // terminal + fully decided: an orphan
  // p-ghost: the branch exists, but no process record was ever saved for it -- also an orphan.
  pendingRecord(store, { id: 'p-pending', state: 'failed', now: nowIso }); // terminal, but NOT fully decided: kept
  pendingRecord(store, { id: 'p-live', state: 'paused', now: nowIso }); // not even terminal: kept

  const oldIso = new Date(Date.now() - 30 * DAY).toISOString();
  pendingRecord(store, { id: 'p-stale', state: 'paused', now: () => oldIso }); // old + pending: flagged
  pendingRecord(store, { id: 'p-fresh', state: 'paused', now: nowIso }); // pending but recent: not flagged

  const dry = gcProcesses(projectRoot, { stateDir, dryRun: true });
  assert.equal(dry.ok, true);
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.worktrees.found, [wtName]);
  assert.deepEqual(dry.worktrees.removed, []);
  assert.deepEqual(dry.branches.found.map((b) => b.branch).sort(), ['construct/bot/p-done', 'construct/bot/p-ghost']);
  assert.deepEqual(dry.branches.found.find((b) => b.branch === 'construct/bot/p-ghost').reason, 'no matching process record');
  assert.deepEqual(dry.branches.found.find((b) => b.branch === 'construct/bot/p-done').reason, 'terminal and fully decided');
  assert.deepEqual(dry.branches.removed, []);
  assert.deepEqual(dry.staleApprovals.map((s) => s.id), ['p-stale']);
  assert.equal(dry.staleApprovals[0].pending.length, 1);
  assert.ok(dry.staleApprovals[0].ageDays >= 30);
  assert.deepEqual(dry.counts, { worktrees: 1, branches: 2, staleApprovals: 1 });

  // A dry run is read-only: nothing on disk or in git actually moved.
  assert.equal(fs.existsSync(path.join(stateDir, 'worktrees', wtName)), true);
  const branches = gitOut(projectRoot, 'branch', '--list', 'construct/bot/*');
  assert.match(branches, /p-done/);
  assert.match(branches, /p-ghost/);
});

test('a real run removes the dead worktree and the orphaned branches, keeps everything else, and never deletes a stale-approval record', () => {
  const projectRoot = repo();
  const stateDir = makeTempDir('construct-gc-state-');
  const store = openProcessStore(projectRoot, { stateDir });
  const dead = deadPid();
  const nowIso = () => new Date().toISOString();
  const wtName = makeWorktreeOrphan(stateDir, { repoDir: projectRoot, processId: 'orphanproc', pid: dead });

  for (const b of ['p-done', 'p-ghost', 'p-pending']) git(projectRoot, 'branch', `construct/bot/${b}`);
  decidedRecord(store, { id: 'p-done', state: 'done', now: nowIso });
  pendingRecord(store, { id: 'p-pending', state: 'failed', now: nowIso });
  const oldIso = new Date(Date.now() - 30 * DAY).toISOString();
  pendingRecord(store, { id: 'p-stale', state: 'paused', now: () => oldIso });

  const result = gcProcesses(projectRoot, { stateDir });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  assert.deepEqual(result.worktrees.removed, [wtName]);
  assert.deepEqual(result.branches.removed.sort(), ['construct/bot/p-done', 'construct/bot/p-ghost']);
  assert.deepEqual(result.counts, { worktrees: 1, branches: 2, staleApprovals: 1 });

  assert.equal(fs.existsSync(path.join(stateDir, 'worktrees', wtName)), false);
  assert.equal(fs.existsSync(path.join(stateDir, 'worktrees', `${wtName}.json`)), false);
  const remaining = gitOut(projectRoot, 'branch', '--list', 'construct/bot/*');
  assert.doesNotMatch(remaining, /p-done/);
  assert.doesNotMatch(remaining, /p-ghost/);
  assert.match(remaining, /p-pending/, 'terminal but not fully decided: kept');
  // The stale-approval record is only ever reported, never touched: the record and its pending artifact remain.
  const stale = store.load('p-stale');
  assert.ok(stale);
  assert.equal(stale.artifacts[0].approved, null);
});

test('--older-than moves the pending-approval threshold', () => {
  const projectRoot = repo();
  const stateDir = makeTempDir('construct-gc-state-');
  const store = openProcessStore(projectRoot, { stateDir });
  const oldIso = new Date(Date.now() - 30 * DAY).toISOString();
  pendingRecord(store, { id: 'p-stale', state: 'paused', now: () => oldIso });

  assert.deepEqual(gcProcesses(projectRoot, { stateDir, dryRun: true, olderThanDays: 14 }).staleApprovals.map((s) => s.id), ['p-stale']);
  assert.deepEqual(gcProcesses(projectRoot, { stateDir, dryRun: true, olderThanDays: 60 }).staleApprovals, []);
});

test('a project that is not a git repository is refused, not thrown', () => {
  const dir = makeTempDir('construct-gc-notrepo-');
  const result = gcProcesses(dir, { stateDir: makeTempDir('construct-gc-state-') });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_A_REPO');
});

test('a project directory that does not exist is refused, not thrown', () => {
  const stateDir = makeTempDir('construct-gc-state-');
  const result = gcProcesses(path.join(stateDir, 'nope'), { stateDir });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROJECT_NOT_FOUND');
});
