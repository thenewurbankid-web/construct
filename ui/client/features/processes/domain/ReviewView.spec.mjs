import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewView, verdictText } from './ReviewView.ts';
import { diffLines } from './DiffLines.ts';
import { validationText } from './ValidationText.ts';
import { initialProcesses, processesReducer } from '../workflows/Processes.ts';

const art = (over = {}) => ({
  path: 'a.ts', change: 'modify', stepId: 's1', diff: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n', diffSha256: 'h'.repeat(64),
  refusals: [], applicable: true, verdict: null, llm: null, ...over,
});
const ready = (artifacts) => ({ status: 'ready', review: { processId: 'p1', state: 'done', artifacts, unrecordedBranchChanges: [], resolved: false } });

test('diff lines are classified for colouring and the text is untouched', () => {
  const lines = diffLines('diff --git a/a b/a\nindex 1..2\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n same\n');
  assert.deepEqual(lines.map((l) => l.kind), ['meta', 'meta', 'meta', 'meta', 'hunk', 'del', 'add', 'ctx']);
  assert.equal(lines[5].text, '-old');
  assert.deepEqual(diffLines(null), []);
});

test('Approve is on only for an artifact the gate reports applicable, undecided and hashed', () => {
  const v = buildReviewView('p1', ready([
    art(),
    art({ path: 'refused.ts', applicable: false, refusals: [{ code: 'OUTSIDE_TOUCHES', message: 'The plan did not declare it.' }] }),
    art({ path: 'nohash.ts', diffSha256: null }),
    art({ path: 'done.ts', verdict: { decision: 'approved', by: 'ada', at: '2026-09-20T12:00:00.000Z' }, applicable: false }),
  ]), {}, null, null);
  const by = Object.fromEntries(v.rows.map((r) => [r.path, r]));
  assert.equal(by['a.ts'].canApprove, true);
  assert.equal(by['refused.ts'].canApprove, false, 'a refusal has no way around it');
  assert.equal(by['refused.ts'].approveOffReason, 'The plan did not declare it.');
  assert.equal(by['nohash.ts'].canApprove, false, 'no hash to echo back, no approval');
  assert.equal(by['done.ts'].canApprove, false);
  assert.equal(by['done.ts'].canReject, false, 'a verdict is final');
  assert.equal(by['done.ts'].verdict, 'Approved by ada at 2026-09-20 12:00:00Z');
  assert.equal(by['a.ts'].diffSha256, 'h'.repeat(64), 'the hash comes from the review, unchanged');
});

test('an artifact can be applicable in the payload yet still refused if a refusal is listed', () => {
  const v = buildReviewView('p1', ready([art({ applicable: true, refusals: [{ code: 'DIRTY', message: 'edited' }] })]), {}, null, null);
  assert.equal(v.rows[0].canApprove, false);
});

test('while a decision is in flight every row is busy', () => {
  const v = buildReviewView('p1', ready([art(), art({ path: 'b.ts' })]), {}, null, 'p1\na.ts');
  assert.deepEqual(v.rows.map((r) => r.busy), [true, true]);
});

test('no review is shown until the gate has answered', () => {
  assert.equal(buildReviewView('p1', undefined, {}, null, null), null);
  assert.equal(buildReviewView('p1', { status: 'loading' }, {}, null, null), null);
});

test('the post-apply check is reported in plain words and never claims a revert', () => {
  assert.match(validationText({ ran: true, ok: true, newViolations: [] }).text, /no new architecture violations/);
  const bad = validationText({ ran: true, ok: false, newViolations: [{ rule: 'LAYER-001', file: 'a.ts', message: 'bad import' }] });
  assert.match(bad.text, /1 new architecture violation/);
  assert.match(bad.text, /Nothing was reverted/);
  assert.deepEqual(bad.violations, ['LAYER-001 a.ts: bad import']);
  assert.match(validationText({ ran: false, error: 'boom', newViolations: [] }).text, /could not run/);
  assert.equal(validationText(null).text, null);
});

test('a verdict reads who and when', () => {
  assert.equal(verdictText(art()), null);
  assert.equal(verdictText(art({ verdict: { decision: 'rejected', by: 'local' } })), 'Rejected by local');
});

test('the reducer keeps the gate\'s review, the last refusal and the last check per process', () => {
  let s = processesReducer(initialProcesses, { type: 'REVIEW', id: 'p1', result: { status: 'loading' } });
  assert.equal(s.reviews.p1.status, 'loading');
  s = processesReducer(s, { type: 'DECIDING', key: 'p1\na.ts' });
  assert.equal(s.deciding, 'p1\na.ts');
  s = processesReducer(s, { type: 'DECIDED', id: 'p1', key: 'p1\na.ts', note: { error: 'stale', refusals: [] }, validation: null });
  assert.equal(s.deciding, null);
  assert.equal(s.notes['p1\na.ts'].error, 'stale');
  assert.equal(s.validations.p1, undefined);
  const check = { ran: true, ok: true, newViolations: [] };
  s = processesReducer(s, { type: 'DECIDED', id: 'p1', key: 'p1\nb.ts', note: null, validation: check });
  assert.deepEqual(s.validations.p1, check);
  s = processesReducer(s, { type: 'DECIDED', id: 'p1', key: 'p1\nc.ts', note: null, validation: null });
  assert.deepEqual(s.validations.p1, check, 'a reject that applied nothing does not erase the last check');
});
