// Pure logic of the Tests screen (#300, #301): file names, the clone dialog, derived views and the state machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify, clonePath, defaultCloneName } from './TestNames.ts';
import { cloneDialogFor, editStepReason, LOCK_REASON } from './CloneDialog.ts';
import { cloneDialogView, selectedTest, summaryOf } from './TestsView.ts';
import { initialTests, testsReducer } from '../workflows/TestsMachine.ts';

const lineage = { title: 'Happy path', machineHash: 'sha256:8f3c2a1deadbeef', scenarioHash: 'sha256:1' };
const data = {
  ok: true, feature: 'refunds', lock: { declared: true, message: null }, scenarios: 2, skipped: [], truncated: false, coverageError: null,
  generated: [{ name: 'refund--happy-path.spec.ts', path: 'features/refunds/tests/generated/refund--happy-path.spec.ts', lineage, area: 'generated', locked: true }],
  yours: [{ name: 'mine.spec.ts', path: 'features/refunds/tests/mine.spec.ts', lineage: null, clonedFrom: { file: 'features/refunds/tests/generated/refund--happy-path.spec.ts', scenario: 'happy-path' }, kind: 'clone', area: 'yours', locked: false }],
  coverage: [
    { n: 1, id: 'refund--happy-path', title: 'Happy path', text: ['Given a', 'When b', 'Then c'], generated: true, file: 'refund--happy-path.spec.ts', cloned: ['mine.spec.ts'] },
    { n: 2, id: 'refund--ends-x', title: 'Path 2', text: [], generated: false, file: null, cloned: [] },
  ],
};

test('slugify makes names the server accepts (^[a-z0-9][a-z0-9-]*$), or nothing', () => {
  assert.equal(slugify('Refund over £50 goes to manual review'), 'refund-over-50-goes-to-manual-review');
  assert.equal(slugify('  Crème brûlée!! '), 'creme-brulee');
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugify('a\0b\nc'), 'a-b-c');
  assert.equal(slugify('!!!'), '');
  assert.ok(slugify('x'.repeat(200)).length <= 80);
  for (const s of ['A B', '..', '/x', 'ünï']) assert.match(slugify(s) || 'ok', /^[a-z0-9][a-z0-9-]*$/);
});

test('the destination shown is the one the server derives', () => {
  assert.equal(clonePath('refunds', 'Refund over 50'), 'features/refunds/tests/refund-over-50.spec.ts');
  assert.equal(defaultCloneName('Happy path'), 'Happy path copy');
});

test('the clone dialog opens with the reason, a default name and the lineage note', () => {
  const d = cloneDialogFor(data, 'refund--happy-path.spec.ts', LOCK_REASON);
  assert.equal(d.steps, 3);
  assert.equal(d.name, 'Happy path copy');
  assert.match(d.reason, /rewrites generated tests every time the flow changes/);
  assert.equal(cloneDialogFor(data, 'nope--x.spec.ts', LOCK_REASON), null);
  const v = cloneDialogView('refunds', { ...d, busy: false, error: null });
  assert.equal(v.slug, 'happy-path-copy');
  assert.equal(v.savedAs, 'features/refunds/tests/happy-path-copy.spec.ts');
  assert.equal(v.lineageNote, 'Happy path · 8f3c2a1');
  assert.match(editStepReason(4), /step 4/);
});

test('an empty name leaves nothing to create', () => {
  const d = cloneDialogFor(data, 'refund--happy-path.spec.ts', LOCK_REASON);
  assert.equal(cloneDialogView('refunds', { ...d, name: '!!!', busy: false, error: null }).slug, '');
});

test('selectedTest finds the test and its scenario; a clone shows the scenario it came from', () => {
  assert.equal(selectedTest(data, { area: 'generated', name: 'refund--happy-path.spec.ts' }).row.title, 'Happy path');
  assert.equal(selectedTest(data, { area: 'yours', name: 'mine.spec.ts' }).row.title, 'Happy path');
  assert.deepEqual(selectedTest(data, { area: 'yours', name: 'gone.spec.ts' }), { test: null, row: null });
  assert.deepEqual(selectedTest(null, null), { test: null, row: null });
  assert.equal(summaryOf(data), '2 scenarios · 1 with a generated test · 1 of your own');
});

test('the machine: pick, load, select, clone dialog lifecycle, a taken name suggests a free one', () => {
  let s = testsReducer(initialTests, { type: 'PICK_FEATURE', feature: 'refunds' });
  s = testsReducer(s, { type: 'LOADED', data });
  s = testsReducer(s, { type: 'SELECT', selection: { area: 'generated', name: 'a' } });
  assert.equal(s.selected.name, 'a');
  s = testsReducer(s, { type: 'OPEN_DIALOG', dialog: { source: 'a', title: 't', hash: null, steps: 1, reason: 'r', name: 'n' } });
  assert.equal(s.dialog.busy, false);
  s = testsReducer(s, { type: 'CLONE_START' });
  assert.equal(s.dialog.busy, true);
  s = testsReducer(s, { type: 'CLONE_FAILED', error: 'exists', suggested: 'n-2' });
  assert.deepEqual([s.dialog.busy, s.dialog.error, s.dialog.name], [false, 'exists', 'n-2']);
  s = testsReducer(s, { type: 'EDIT_NAME', name: 'other' });
  assert.equal(s.dialog.error, null);
  s = testsReducer(s, { type: 'CLONE_DONE', name: 'other.spec.ts', path: 'features/refunds/tests/other.spec.ts' });
  assert.equal(s.dialog, null);
  assert.deepEqual(s.selected, { area: 'yours', name: 'other.spec.ts' });
  assert.match(s.notice, /nothing regenerates it/);
  assert.equal(testsReducer(s, { type: 'PICK_FEATURE', feature: 'x' }).selected, null);
});
