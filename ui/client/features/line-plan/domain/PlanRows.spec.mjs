import test from 'node:test';
import assert from 'node:assert/strict';
import { callText, lastRun, planRows, stepRow, toPlanAnswer } from './PlanRows.ts';
import { approveAndRun, chooseAndRun, choiceStep } from '../workflows/ApproveFlow.ts';

const apply = { ok: true, sentence: 'Saved. Creates StatusBadge in feature orders, based on the library Badge.', files: ['features/orders/components/StatusBadge.tsx'], findings: [] };
const waiting = { id: 's1', n: 1, tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge', expect: [] }, why: 'Creates StatusBadge.', kind: 'write', state: 'waiting', sentence: 'Waiting for your approval: Creates StatusBadge.', gap: [{ checkId: 'files', state: 'missing', sentence: 'To do: write StatusBadge.tsx.' }], result: null, error: null };
const needs = {
  ...waiting, id: 's2', n: 2, state: 'needs-you', sentence: 'This needs you: 0 of 2 checks passed.', gap: [],
  result: { apply: { ok: false, sentence: 'Nothing was saved: no.', files: [], findings: [] }, checks: [{ checkId: 'validate', ok: false, sentence: 'Not checked.' }, { checkId: 'files', ok: false, sentence: 'StatusBadge.tsx is not as planned.' }], passed: 0, total: 2, needsYou: true, options: [{ id: 'fix', sentence: 'Add a base.' }, { id: 'retry', sentence: 'Try this step again.' }, { id: 'leave', sentence: 'Leave it as it is and carry on.' }], stopped: false, sentence: 'This needs you.' },
};
const done = { ...waiting, id: 's3', n: 3, state: 'done', sentence: apply.sentence, gap: [], result: { apply, checks: [{ checkId: 'validate', ok: true, sentence: 'Validate shows no new problems.' }], passed: 1, total: 1, needsYou: false, options: [], stopped: false, sentence: apply.sentence } };
const view = (steps) => ({ ok: true, sessionId: 'ses-cockpit', planId: 'plan-cockpit-1', version: 3, status: 'running', steps, store: { linked: false, sentence: 'Built-in.' } });

test('rows: a waiting step can be approved and says what is still to do; the tool call is for Details only', () => {
  const r = stepRow(waiting);
  assert.deepEqual([r.stateLabel, r.canApprove, r.gapLines, r.choices], ['Waiting for your approval', true, ['To do: write StatusBadge.tsx.'], []]);
  assert.equal(r.call, 'line.baseOn({"libraryId":"components/Badge","feature":"orders","name":"StatusBadge"})');
  assert.equal(callText({ tool: 'line.project', args: {} }), 'line.project({})');
});

test('rows: a step that needs you lists the failing checks, the suggested fixes and the two choices', () => {
  const r = stepRow(needs);
  assert.deepEqual(r.failing, ['Not checked.', 'StatusBadge.tsx is not as planned.']);
  assert.deepEqual(r.fixes, ['Add a base.']);
  assert.deepEqual(r.choices.map((c) => [c.id, c.label]), [['retry', 'Try again'], ['leave', 'Leave as it is']]);
  assert.equal(r.canApprove, false);
});

test('rows: newest first; the last run is the step the person ran, once it ran, with its ApplyResult', () => {
  assert.deepEqual(planRows(view([waiting, needs, done])).map((r) => r.id), ['s3', 's2', 's1']);
  assert.deepEqual(lastRun(view([done, waiting]), 's3'), { stepId: 's3', tool: 'line.baseOn', apply, sentence: apply.sentence });
  assert.equal(lastRun(view([done, waiting]), null), null, 'an old step is not news');
  assert.equal(lastRun(view([waiting]), 's1'), null, 'not before it ran');
  assert.deepEqual(stepRow(done).files, apply.files);
});

test('answers: a PlanView, a refusal sentence, or a fallback sentence', () => {
  assert.equal(toPlanAnswer(view([])).ok, true);
  assert.deepEqual(toPlanAnswer({ ok: false, sentence: 'No.', code: 'X' }), { ok: false, sentence: 'No.' });
  assert.deepEqual(toPlanAnswer(null), { ok: false, sentence: 'Cockpit could not read the plan; nothing was changed.' });
});

test('flows: Approve approves then runs that step; a choice adds its step, approves and runs it; a refusal stops the flow', async () => {
  const calls = [];
  const api = {
    getPlan: async () => ({ ok: true, view: view([]) }),
    addStep: async (req) => { calls.push(['add', req]); return { ok: true, view: { ...view([]), stepId: 's9' } }; },
    approve: async (id) => { calls.push(['approve', id]); return id === 'bad' ? { ok: false, sentence: 'Only a person.' } : { ok: true, view: view([]) }; },
    run: async (id) => { calls.push(['run', id]); return { ok: true, view: view([]) }; },
  };
  await approveAndRun(api, 's1');
  assert.deepEqual(calls.splice(0), [['approve', 's1'], ['run', 's1']]);
  assert.deepEqual(await approveAndRun(api, 'bad'), { ok: false, sentence: 'Only a person.' });
  assert.deepEqual(calls.splice(0), [['approve', 'bad']]);
  await chooseAndRun(api, 'line.baseOn', 's2', 'retry');
  assert.deepEqual(calls.splice(0), [['add', { tool: 'line.baseOn', args: { retry: { of: 's2' } } }], ['approve', 's9'], ['run', 's9']]);
  assert.deepEqual(choiceStep('line.baseOn', 's2', 'leave'), { tool: 'line.leaveAsIs', args: { stepId: 's2' } });
});
