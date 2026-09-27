// #416 -- turning the dry-run gc report into what the drawer shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gcCleanupCount, gcDetailLines } from './GcCounts.ts';

const REPORT = {
  counts: { worktrees: 1, branches: 2, staleApprovals: 1 },
  worktrees: { found: ['123-orphanproc'] },
  branches: { found: [{ branch: 'construct/bot/p-done', processId: 'p-done', reason: 'terminal and fully decided' }, { branch: 'construct/bot/p-ghost', processId: 'p-ghost', reason: 'no matching process record' }] },
  staleApprovals: [{ id: 'p-stale', ageDays: 30, pending: ['features/checkout/index.ts'] }],
};

test('null or absent gc means nothing to clean up', () => {
  assert.equal(gcCleanupCount(null), 0);
  assert.deepEqual(gcDetailLines(null), []);
});

test('the count is every worktree, branch and stale-approval record added together', () => {
  assert.equal(gcCleanupCount(REPORT), 4);
  assert.equal(gcCleanupCount({ ...REPORT, counts: { worktrees: 0, branches: 0, staleApprovals: 0 } }), 0);
});

test('one detail line per item, in plain words', () => {
  const lines = gcDetailLines(REPORT).map((l) => l.text);
  assert.deepEqual(lines, [
    'Dead-owner worktree 123-orphanproc',
    'Orphaned branch construct/bot/p-done (terminal and fully decided)',
    'Orphaned branch construct/bot/p-ghost (no matching process record)',
    'p-stale: 1 artifact(s) pending approval, 30d old',
  ]);
});
