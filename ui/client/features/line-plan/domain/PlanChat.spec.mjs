import test from 'node:test';
import assert from 'node:assert/strict';
import { chatOption, chatStart, crumbTarget, crumbsOf, optionsAt, placeFromSearch, providerProblems } from '../../../lib/lineModes.ts';
import { MOCK_PROVIDER, MOCK_WORLD } from '../../../lib/lineModesMock.ts';
import { PLAN_CHAT, planDecision, planDecisionOn, withPlanOptions } from './PlanChat.ts';
import { planRows } from './PlanRows.ts';

const waiting = { id: 's1', n: 1, tool: 'line.baseOn', args: {}, why: 'Creates StatusBadge.', kind: 'write', state: 'waiting', sentence: 'Waiting for your approval: Creates StatusBadge in feature orders.', gap: [], result: null, error: null };
const needs = {
  ...waiting, id: 's2', n: 2, state: 'needs-you', sentence: 'This needs you: 0 of 2 checks passed.',
  result: { apply: { ok: false, sentence: 'Nothing was saved.', files: [], findings: [] }, checks: [{ checkId: 'files', ok: false, sentence: 'StatusBadge.tsx is not as planned.' }], passed: 0, total: 1, needsYou: true, options: [{ id: 'fix', fixId: 'a', sentence: 'Move it.', recommended: false, step: { tool: 'line.moveFile', args: {} } }, { id: 'fix', fixId: 'b', sentence: 'Promote it.', recommended: true, step: { tool: 'line.promote', args: {} } }, { id: 'retry', sentence: 'Try this step again.' }, { id: 'leave', sentence: 'Leave it as it is and carry on.' }], stopped: false, sentence: 'This needs you.' },
};
const done = { ...waiting, id: 's3', n: 3, state: 'done', sentence: 'Saved: Creates OrderBadge in feature orders.' };
const view = (steps) => ({ ok: true, sessionId: 's', planId: 'p', version: 1, status: 'running', steps, store: { linked: false, sentence: 'Built-in.' } });
const rows = planRows(view([waiting, needs, done]));
const root = { screen: 'plan', steps: [] };

test('plan chat: passes the options-provider contract, empty or full', () => {
  assert.deepEqual(providerProblems(PLAN_CHAT, root, []), []);
  assert.deepEqual(providerProblems(PLAN_CHAT, root, rows), []);
});

test('plan chat: stable dotted ids, one Approve per waiting step and each choice of a step that needs the person', () => {
  const ids = PLAN_CHAT.options(root, rows).map((o) => o.id);
  assert.deepEqual(ids, ['plan.steps', 'plan.fix.step-2', 'plan.fix-2.step-2', 'plan.retry.step-2', 'plan.leave.step-2', 'plan.approve.step-1']);
  const approve = PLAN_CHAT.options(root, rows).find((o) => o.id === 'plan.approve.step-1');
  assert.deepEqual([approve.label, approve.effect], ['Approve step 1', 'plan']);
  assert.equal(PLAN_CHAT.options(root, rows).find((o) => o.id === 'plan.fix.step-2').label, 'Apply recommended fix (step 2)');
  assert.deepEqual(PLAN_CHAT.options(root, []).map((o) => o.id), ['plan.steps']);
});

test('plan chat: "What is in the plan" answers every step in plain English; the decisions are left to the screen', () => {
  const a = PLAN_CHAT.answer('plan.steps', root, rows);
  assert.match(a.text, /^The plan has 3 steps, and 2 wait for you\./);
  assert.match(a.text, /Step 1: Waiting for your approval: Creates StatusBadge in feature orders\./);
  assert.equal(PLAN_CHAT.answer('plan.steps', root, []).text, 'The plan has no steps yet.');
  assert.equal(PLAN_CHAT.answer('plan.approve.step-1', root, rows), null);
  assert.equal(PLAN_CHAT.intro(root, rows).text, 'The plan has 3 steps, and 2 wait for you.');
});

test('plan chat: an option id names the decision (Approve, a fix, Try again, Leave as it is) on the right step', () => {
  assert.deepEqual(planDecision('plan.approve.step-1', rows), { kind: 'approve', stepId: 's1' });
  const fix = planDecision('plan.fix.step-2', rows);
  assert.deepEqual([fix.kind, fix.stepId, fix.choice.label], ['choose', 's2', 'Apply recommended fix']);
  assert.equal(planDecision('plan.fix-2.step-2', rows).choice.label, 'Apply fix 2');
  assert.equal(planDecision('plan.leave.step-2', rows).choice.id, 'leave');
  assert.equal(planDecision('plan.approve.step-3', rows), null, 'a done step cannot be approved');
  assert.equal(planDecision('plan.steps', rows), null);
  assert.equal(planDecision('plan.approve.step-9', rows), null);
});

test('plan chat on a screen: the Plan options join the screen chat as "<screen>.plan.*", the screen\'s own levels and crumbs unchanged', () => {
  const P = withPlanOptions(MOCK_PROVIDER);
  const data = { screen: MOCK_WORLD, plan: rows };
  const place = placeFromSearch(P, '?feature=orders&item=OrdersPage', data);
  assert.deepEqual(providerProblems(P, place, data), []);
  const ids = optionsAt(P, place, data).map((o) => o.id);
  assert.deepEqual(ids, ['mock.open', 'mock.explain', 'mock.plan.steps', 'mock.plan.fix.step-2', 'mock.plan.fix-2.step-2', 'mock.plan.retry.step-2', 'mock.plan.leave.step-2', 'mock.plan.approve.step-1', 'mock.up']);
  assert.deepEqual(crumbsOf(P, place).map((c) => c.label), ['Features', 'orders', 'OrdersPage']);
  assert.equal(crumbTarget(crumbsOf(P, place)[1]).href, '/mock?feature=orders');
  // Read options answer in the conversation; a decision is not answered, so the screen runs it.
  const s = chatStart(P, place, data);
  assert.match(chatOption(s, P, data, 'mock.plan.steps').log.at(-1).text, /^The plan has 3 steps/);
  assert.equal(chatOption(s, P, data, 'mock.plan.approve.step-1'), s);
  assert.deepEqual(planDecisionOn('mock', 'mock.plan.approve.step-1', rows), { kind: 'approve', stepId: 's1' });
  assert.equal(planDecisionOn('mock', 'mock.explain', rows), null);
});

test('plan chat: the Plan panel\'s own crumb is the Plan, on Components', () => {
  assert.deepEqual(crumbsOf(PLAN_CHAT, root).map((c) => [c.label, c.href]), [['Plan', '/components']]);
  assert.equal(crumbTarget(crumbsOf(PLAN_CHAT, root)[0]).mode, 'hood');
});
