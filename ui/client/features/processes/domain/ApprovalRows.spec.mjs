import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApprovalRows, pendingApprovalCount } from './ApprovalRows.ts';

const summary = (over = {}) => ({
  id: 'p1', title: 'Add totals', state: 'done', stateDetail: 'done', pendingControl: null, currentStepId: null,
  progress: { done: 4, failed: 0, total: 4 }, modelSteps: 1, plannedModelSteps: 1, artifacts: 1, pendingApproval: 0,
  version: 1, createdAt: '2026-09-20T12:00:00.000Z', startedAt: null, finishedAt: null, terminal: true, controls: [], error: null, ...over,
});

test('buildApprovalRows keeps only processes with something waiting, carrying the title and count', () => {
  const rows = buildApprovalRows([
    summary({ id: 'p1', title: 'Add totals', pendingApproval: 2 }),
    summary({ id: 'p2', title: 'Still running', state: 'running', pendingApproval: 0 }),
    summary({ id: 'p3', title: 'Rename fields', pendingApproval: 1 }),
  ]);
  assert.deepEqual(rows, [
    { id: 'p1', title: 'Add totals', pending: 2 },
    { id: 'p3', title: 'Rename fields', pending: 1 },
  ]);
});

test('buildApprovalRows is empty when nothing is waiting', () => {
  assert.deepEqual(buildApprovalRows([summary({ pendingApproval: 0 })]), []);
  assert.deepEqual(buildApprovalRows([]), []);
});

test('pendingApprovalCount sums across every process, for the tab badge', () => {
  assert.equal(pendingApprovalCount([summary({ pendingApproval: 2 }), summary({ id: 'p2', pendingApproval: 1 })]), 3);
  assert.equal(pendingApprovalCount([summary({ pendingApproval: 0 })]), 0);
  assert.equal(pendingApprovalCount([]), 0);
});
