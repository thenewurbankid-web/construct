import test from 'node:test';
import assert from 'node:assert/strict';
import { controlButtons } from './ControlButtons.ts';
import { executorLabel } from './StepLabels.ts';
import { progressPercent, progressText, runningCount } from './ProcessCounts.ts';
import { artifactRow, buildDetailView } from './DetailView.ts';
import { buildListRows } from './ListRows.ts';
import { initialProcesses, processesReducer, summariesOf } from '../workflows/Processes.ts';

const summary = (over = {}) => ({
  id: 'p1', title: 'Add totals', state: 'running', stateDetail: 'running.active', pendingControl: null, currentStepId: 'a',
  progress: { done: 1, failed: 0, total: 4 }, modelSteps: 0, plannedModelSteps: 1, artifacts: 0, pendingApproval: 0,
  version: 1, createdAt: '2026-09-20T12:00:00.000Z', startedAt: null, finishedAt: null, terminal: false, controls: ['PAUSE', 'CANCEL'], error: null, ...over,
});
const detail = (over = {}) => ({ summary: summary(), steps: [], artifacts: [], log: [], logHidden: 0, ...over });

test('the three executors read as Deterministic, Local model and You', () => {
  assert.equal(executorLabel('deterministic'), 'Deterministic');
  assert.equal(executorLabel('local-model'), 'Local model');
  assert.equal(executorLabel('user'), 'You');
});

test('buttons are exactly what the machine offers: nothing invented, START never shown', () => {
  assert.deepEqual(controlButtons(['PAUSE', 'CANCEL']).map((b) => b.verb), ['pause', 'cancel']);
  assert.deepEqual(controlButtons(['RESUME', 'CANCEL']).map((b) => b.verb), ['resume', 'cancel']);
  assert.deepEqual(controlButtons(['RETRY']).map((b) => b.verb), ['retry']);
  assert.deepEqual(controlButtons(['START', 'CANCEL']).map((b) => b.verb), ['cancel']);
  assert.deepEqual(controlButtons([]), []);
});

test('runningCount counts only running processes; a paused one is not running', () => {
  assert.equal(runningCount([summary(), summary({ id: 'p2', state: 'paused' }), summary({ id: 'p3' }), summary({ id: 'p4', state: 'done' })]), 2);
  assert.equal(runningCount([]), 0);
});

test('progress text and percent never claim completion early', () => {
  assert.equal(progressText({ done: 1, failed: 0, total: 4 }), '1 of 4 steps');
  assert.equal(progressText({ done: 2, failed: 1, total: 3 }), '2 of 3 steps, 1 failed');
  assert.equal(progressPercent({ done: 2, failed: 0, total: 3 }), 66);
  assert.equal(progressPercent({ done: 0, failed: 0, total: 0 }), 0);
});

test('a pending pause is shown as such while the machine is still running', () => {
  const [row] = buildListRows([summary({ pendingControl: 'pause' })], 'p1');
  assert.equal(row.note, 'Pausing after the current step');
  assert.equal(row.selected, true);
});

test('a settled process does not keep saying it is pausing', () => {
  const [row] = buildListRows([summary({ state: 'paused', pendingControl: 'pause' })], null);
  assert.equal(row.note, null);
});

test('reducer: a stale update (a response arriving after a newer socket frame) is dropped', () => {
  let s = processesReducer(initialProcesses, { type: 'UPDATE', detail: detail({ summary: summary({ version: 9, state: 'cancelled', controls: [] }) }) });
  s = processesReducer(s, { type: 'UPDATE', detail: detail({ summary: summary({ version: 7, state: 'running' }) }) });
  assert.equal(s.details.p1.summary.state, 'cancelled');
  s = processesReducer(s, { type: 'LISTED', summaries: [summary({ version: 8, state: 'running' })] });
  assert.equal(s.details.p1.summary.state, 'cancelled', 'an older list read does not roll a process back either');
  s = processesReducer(s, { type: 'LISTED', summaries: [summary({ version: 9, state: 'cancelled' })] });
  assert.equal(s.details.p1.summary.version, 9);
});

test('artifacts are shown awaiting approval, read-only, with a short hash', () => {
  const row = artifactRow({ path: 'a.ts', change: 'create', stepId: 's', approved: null, before: null, after: { bytes: 3, sha256: 'abcdef0123456789' } });
  assert.deepEqual(row, { path: 'a.ts', change: 'create', hash: 'abcdef0123', approval: 'Awaiting approval' });
});

test('the detail view tags each step and keeps log provenance', () => {
  const view = buildDetailView(detail({
    steps: [{ id: 'a', title: 'A', flow: 'f', executor: 'local-model', status: 'done', attempts: 1, durationMs: 1, llm: { provider: 'ollama', calls: 2 }, error: null }],
    log: [{ seq: 1, at: '2026-09-20T12:00:00.000Z', provenance: 'llm', message: 'hello', stepId: 'a' }],
  }));
  assert.equal(view.steps[0].kind, 'Local model');
  assert.equal(view.steps[0].note, 'Model: ollama, 2 call(s)');
  assert.equal(view.log[0].provenance, 'llm');
  assert.deepEqual(view.buttons.map((b) => b.verb), ['pause', 'cancel']);
});

test('reducer: list, live update upsert, selection and control notice', () => {
  let s = processesReducer(initialProcesses, { type: 'LISTED', summaries: [summary(), summary({ id: 'p0', state: 'done' })] });
  assert.equal(s.selectedId, 'p1');
  assert.deepEqual(s.order, ['p1', 'p0']);
  s = processesReducer(s, { type: 'UPDATE', detail: detail({ summary: summary({ state: 'paused', controls: ['RESUME', 'CANCEL'] }) }) });
  assert.equal(summariesOf(s)[0].state, 'paused');
  s = processesReducer(s, { type: 'UPDATE', detail: detail({ summary: summary({ id: 'pNew' }) }) });
  assert.deepEqual(s.order, ['pNew', 'p1', 'p0'], 'a process the list did not have yet goes on top');
  assert.equal(s.selectedId, 'pNew', 'and takes the selection, since it appeared while you were watching');
  s = processesReducer(s, { type: 'SELECT', id: 'p1' });
  s = processesReducer(s, { type: 'UPDATE', detail: detail({ summary: summary({ id: 'pNew', state: 'done' }) }) });
  assert.equal(s.selectedId, 'p1', 'an update to a known process never steals the selection');
  s = processesReducer(s, { type: 'CONTROL_START', id: 'p1' });
  assert.equal(s.busyId, 'p1');
  s = processesReducer(s, { type: 'CONTROL_DONE', notice: 'refused' });
  assert.deepEqual([s.busyId, s.notice], [null, 'refused']);
  s = processesReducer(s, { type: 'LISTED', summaries: [summary({ id: 'p0' })] });
  assert.equal(s.selectedId, 'p0', 'a selection that vanished falls back to the first');
});
