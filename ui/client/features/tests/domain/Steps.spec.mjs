// Pure logic of the step editor (#302): the draft (add / remove / reorder / change), what changed, the words of a
// row, and the editor's state machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { changeOf, draftOf, payloadOf } from './StepDraft.ts';
import { changeCount, problemsOf } from './StepChanges.ts';
import { canMove, insertStep, move } from './StepMoves.ts';
import { blankStep } from './StepNew.ts';
import { stepRows } from './StepView.ts';
import { bindingOf, codeOf } from './StepCode.ts';
import { humanize, keywordOf, sentenceOf } from './StepText.ts';
import { initialStepEditor, stepEditorReducer } from '../workflows/StepEditorMachine.ts';

const machine = { key: 'refund', id: 'refund', initial: 'idle', events: [{ event: 'REQUEST_REFUND', testId: 'request-refund', label: 'request refund' }, { event: 'CLOSE', testId: 'close', label: 'close' }], states: ['idle', 'autoCheck', 'manualReview'] };
const steps = [
  { kind: 'goto', url: '/refunds/new' },
  { kind: 'state', state: 'idle' },
  { kind: 'event', event: 'REQUEST_REFUND', testId: 'request-refund', note: 'When "request refund" happens' },
  { kind: 'state', state: 'autoCheck' },
];
const doc = (over = {}) => ({ ok: true, editable: true, name: 'mine.spec.ts', path: 'features/refunds/tests/mine.spec.ts', hash: 'h', kind: 'clone', lineage: null, title: 'T', machine, steps: steps.map((s) => ({ ...s, keyword: '', sentence: '', binding: '' })), ...over });
const opened = () => stepEditorReducer(stepEditorReducer(initialStepEditor, { type: 'OPEN', name: 'mine.spec.ts' }), { type: 'LOADED', doc: doc() });

test('words: keywords, sentences, bindings and the code preview follow the convention', () => {
  assert.equal(humanize('REQUEST_REFUND'), 'request refund');
  assert.equal(humanize('manualReview'), 'manual review');
  assert.deepEqual(steps.map((s, i) => keywordOf(s, steps[i - 1] ?? null)), ['GIVEN', 'AND', 'WHEN', 'THEN']);
  assert.equal(sentenceOf(steps[0], null), 'Open /refunds/new');
  assert.equal(sentenceOf(steps[1], steps[0]), 'the flow starts at idle');
  assert.equal(sentenceOf(steps[3], steps[2]), 'the flow moves to auto check');
  assert.equal(bindingOf(steps[2]), '[data-testid="request-refund"]');
  assert.equal(bindingOf(steps[3]), '[data-flow-state="autoCheck"]');
  assert.equal(codeOf({ kind: 'check-text', text: 'a "b"', timeout: 5000 }), 'await expect(page.getByText("a \\"b\\"")).toBeVisible({ timeout: 5000 });');
});

test('the draft: add, remove, reorder and change; nothing moves before the page is opened', () => {
  const orig = steps;
  let d = draftOf(orig);
  assert.equal(changeCount(d, orig), 0);
  d = insertStep(d, 3, blankStep('check-text', machine), 10);
  assert.equal(d.at(-1).step.kind, 'check-text');
  assert.equal(changeOf(d.at(-1), orig), 'added');
  assert.equal(changeCount(d, orig), 1);
  assert.deepEqual(problemsOf(d), ['Step 5: type the text the page should show.']);
  d = insertStep(d, 0, blankStep('state', machine), 11); // "after the page-open row" is fine; "before" is impossible
  assert.equal(d[1].key, 11);
  assert.equal(canMove(d, 0, 1), false, 'the page-open row does not move');
  assert.equal(canMove(d, 11, -1), false, 'and nothing moves above it');
  const swapped = move(d, 2, 1); // the old first state moves down
  assert.notDeepEqual(swapped.map((x) => x.key), d.map((x) => x.key));
  assert.equal(payloadOf(draftOf(orig).map((x, i) => (i === 3 ? { ...x, removed: true } : x))).length, 3);
  assert.equal(changeOf({ ...draftOf(orig)[3], removed: true }, orig), 'removed');
  assert.equal(changeOf({ ...draftOf(orig)[3], step: { kind: 'state', state: 'manualReview' } }, orig), 'changed');
  assert.equal(problemsOf(draftOf([{ kind: 'goto', url: 'https://evil.example' }])).length, 1);
  assert.equal(problemsOf(draftOf([{ kind: 'goto', url: '/ok/path?x=1' }])).length, 0);
});

test('the rows skip removed steps in numbering and keywords', () => {
  const d = draftOf(steps).map((x, i) => (i === 2 ? { ...x, removed: true } : x));
  const rows = stepRows(d, steps);
  assert.deepEqual(rows.map((r) => r.n), [1, 2, null, 3]);
  assert.equal(rows[2].removed, true);
  assert.equal(rows[3].keyword, 'AND', 'with the event removed, the state after it is no longer a THEN');
});

test('the machine: open, edit, review, and the data-testid follows the chosen event', () => {
  let s = opened();
  assert.equal(s.status, 'editing');
  assert.equal(s.draft.length, 4);
  s = stepEditorReducer(s, { type: 'PATCH', key: 2, patch: { event: 'CLOSE' } });
  assert.equal(s.draft[2].step.testId, 'close');
  assert.equal(s.draft[2].step.note, 'When "request refund" happens', 'the note stays');
  s = stepEditorReducer(s, { type: 'ADD', kind: 'check-text' });
  assert.equal(s.draft.length, 5);
  assert.equal(s.selected, 4);
  s = stepEditorReducer(s, { type: 'REMOVE', key: 4 });
  assert.equal(s.draft.length, 4, 'a row added and not saved just disappears');
  s = stepEditorReducer(s, { type: 'REMOVE', key: 3 });
  assert.equal(s.draft[3].removed, true, 'a saved row stays, struck through');
  s = stepEditorReducer(s, { type: 'MOVE', key: 1, dir: 1 });
  assert.match(s.announce, /^Moved to step 3 of 4/);
  s = stepEditorReducer(s, { type: 'REVIEW_START' });
  assert.equal(s.review.status, 'loading');
  s = stepEditorReducer(s, { type: 'REVIEW_READY', resultSha: 'x', changed: true, rows: [], added: 1, removed: 1 });
  assert.equal(s.review.status, 'ready');
  s = stepEditorReducer(s, { type: 'PATCH', key: 1, patch: { state: 'manualReview' } });
  assert.equal(s.review.status, 'none', 'editing again discards a review: the diff would no longer be the change');
  s = stepEditorReducer(s, { type: 'DISCARD' });
  assert.equal(changeCount(s.draft, s.original), 0);
  assert.equal(stepEditorReducer(s, { type: 'REMOVE', key: 0 }).draft[0].removed, false, 'the page-open row cannot be removed');
});

test('the machine: a file that is not editable is read-only with its reason, an error is shown, a stale review says so', () => {
  const ro = stepEditorReducer(initialStepEditor, { type: 'LOADED', doc: { ok: true, editable: false, name: 'x.spec.ts', path: 'p', hash: 'h', kind: 'authored', lineage: null, reason: 'line 3: a statement the step editor does not know.' } });
  assert.equal(ro.status, 'readonly');
  assert.match(ro.reason, /line 3/);
  assert.equal(stepEditorReducer(ro, { type: 'PATCH', key: 0, patch: {} }), ro, 'nothing can be edited');
  assert.equal(stepEditorReducer(initialStepEditor, { type: 'LOADED', doc: { ok: false, error: 'nope' } }).status, 'error');
  const s = stepEditorReducer(opened(), { type: 'REVIEW_FAILED', message: 'changed', stale: true });
  assert.equal(s.review.stale, true);
});
