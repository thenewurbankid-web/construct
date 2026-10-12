// im2 wiring -- where a Qwen or jev option is refused, the local model repairs it ONCE from Construct's exact error:
//   the import fix loop (importAgent.mjs): the fix jev picked is refused; the repaired fix joins the plan as a waiting
//     step (a person approves it), lands, and the import goes on; refused again, the person is asked;
//   the drafter route check (planDraft.mjs): a model's route Construct refused is repaired, checked on a copy, and can
//     be added (still waiting for approval); Ollama down leaves it refused with one sentence.
// Mock Qwen throughout (the live 1.5B run is test/line-repair-live.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertImportAgentView } from '../packages/engine/line/contract.mjs';
import { createMockImportAgentService, createMockPlanService } from '../packages/engine/line/mockImportAgent.mjs';
import { createPlanDrafter } from '../packages/engine/line/drafter/planDraft.mjs';
import { draft as staticDraft } from '../packages/engine/line/drafter/index.mjs';
import { verifyRoutes } from '../packages/engine/line/drafter/verify.mjs';
import { createLinePlanService } from '../packages/engine/line/planService.mjs';
import { createRepairer } from '../packages/engine/line/repair.mjs';
import { repairLoop, ollamaPropose } from '../packages/core/line-decide.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(REPO, 'examples/line-sample');
const FOLDER = 'src/alerts';
/** jev answers every fix question with Construct's recommended fix (so the fix counts as jev's pick). */
const jev = { suggest: async (q) => ({ option: q.options[0].id, reason: 'jev picked the recommended fix.' }) };

async function approveAlong(agent, planService, v, max = 40) {
  for (let i = 0; i < max && v.waiting?.for === 'approval'; i += 1) {
    const a = await planService.approve(v.waiting.planStepId, 'ui');
    assert.equal(a.ok, true, a.sentence);
    v = await agent.resume('ui');
    assertImportAgentView(v);
  }
  return v;
}

/** Construct's check of a repaired fix, mocked like the mock plan service: a fix to components/AlertRowBase lands. */
const fixCheck = (o) => (o.args.args?.libraryId === 'components/AlertRowBase' ? { ok: true } : { ok: false, refusal: { sentence: `Construct refused the fix: the library has no ${o.args.args?.libraryId}.` } });
const fixTo = (option, libraryId, reason) => JSON.stringify({ reason, tool: option.tool, args: { ...option.args, args: { ...option.args.args, libraryId } } });

test('import fix loop: the fix jev picked is refused; the model lands on attempt 2, each attempt said in the change log; the repaired fix waits for approval, lands, and the import ends', async () => {
  const asked = [];
  const repair = (option, refusal, c) => repairLoop(option, refusal, { check: fixCheck, onProgress: c?.onProgress, propose: async (q) => { asked.push(q.prompt); return asked.length === 1 ? fixTo(option, 'components/Row', 'AlertRow is not in the library; trying Row.') : fixTo(option, 'components/AlertRowBase', 'Row was refused too; the base is AlertRowBase.'); } });
  const planService = createMockPlanService({ refuseFix: (s) => s.args.args?.libraryId !== 'components/AlertRowBase' });
  const svc = createMockImportAgentService({ planService, reason: jev, repair });
  const agent = svc.agentFor(FOLDER);
  await agent.start('ui');
  let v = await agent.editStep('ui', { action: 'approve-all' });
  // The jev-picked fix waits for the person; approve it: Construct refuses it, and the model repairs it.
  v = await approveAlong(agent, planService, v, 1);
  assert.equal(asked.length, 2, 'two attempts: the second landed');
  assert.match(asked[0], /^Construct refused this change\.\nError: Construct refused the fix: the library has no components\/AlertRow\./);
  assert.match(asked[1], /Attempt 1: .*components\/Row.* was refused too: Construct refused the fix: the library has no components\/Row\./);
  const d = v.decisions.find((x) => x.id.startsWith('repair:'));
  assert.deepEqual([d.picked, d.by], ['repair', 'model']);
  assert.match(d.reason, /^Attempt 1: AlertRow is not in the library; trying Row; refused: .* Attempt 2: Row was refused too; the base is AlertRowBase\.$/);
  const live = v.changes.map((c) => c.sentence).filter((x) => /local model to repair it|trying again/.test(x));
  assert.equal(live.length, 2, 'one live line per attempt, in order');
  assert.match(live[0], /\(1 of 4\)/);
  assert.match(live[1], /\(2 of 4\)/);
  assert.equal(v.waiting.for, 'approval', 'the repaired fix waits for a person');
  const repaired = planService.steps.find((s) => s.id === v.waiting.planStepId);
  assert.equal(repaired.args.args.libraryId, 'components/AlertRowBase');
  assert.equal(repaired.state, 'waiting', 'nothing runs before approval');
  v = await approveAlong(agent, planService, v);
  assert.equal(v.state, 'done', JSON.stringify(v.waiting));
  assert.equal(v.sentence, 'Done: 10 steps landed.');
});

test('import fix loop: 4 refused attempts go to the person with every attempt listed; a repair refused when it runs asks too; a static pick is never repaired', async () => {
  let n = 0;
  const repair = (option, refusal, c) => repairLoop(option, refusal, { check: fixCheck, onProgress: c?.onProgress, propose: async () => { n += 1; return fixTo(option, `components/Nope${n}`, `Trying Nope${n}.`); } });
  const planService = createMockPlanService({ refuseFix: () => true });
  const agent = createMockImportAgentService({ planService, reason: jev, repair }).agentFor(FOLDER);
  await agent.start('ui');
  let v = await agent.editStep('ui', { action: 'approve-all' });
  v = await approveAlong(agent, planService, v);
  assert.equal(n, 4);
  assert.equal(v.waiting.for, 'answer');
  assert.match(v.waiting.sentence, /the fix Line tried was refused too/);
  const d = v.decisions.find((x) => x.id.startsWith('repair:'));
  assert.equal(d.picked, 'ask');
  assert.equal((d.reason.match(/Attempt \d/g) ?? []).length, 4, 'every attempt is listed');
  // A repair proposed without a check on a copy is checked when it runs; refused then, the person decides.
  const proposeOnly = (option, refusal) => repairLoop(option, refusal, { propose: async () => fixTo(option, 'components/Nope', 'Trying Nope.') });
  const p3 = createMockPlanService({ refuseFix: () => true });
  const a3 = createMockImportAgentService({ planService: p3, reason: jev, repair: proposeOnly }).agentFor(FOLDER);
  await a3.start('ui');
  let x = await a3.editStep('ui', { action: 'approve-all' });
  x = await approveAlong(a3, p3, x);
  assert.match(x.waiting.sentence, /the local model's repair of the fix was refused too when it ran: construct refused the fix: the library has no components\/Nope\./);
  // Static order (no jev): the person decides as before, no model is asked.
  let calls = 0;
  const p2 = createMockPlanService({ refuseFix: () => true });
  const a2 = createMockImportAgentService({ planService: p2, repair: async () => { calls += 1; return null; } }).agentFor(FOLDER);
  await a2.start('ui');
  let w = await a2.editStep('ui', { action: 'approve-all' });
  w = await approveAlong(a2, p2, w);
  assert.equal(calls, 0);
  assert.match(w.waiting.sentence, /the fix Line tried was refused too/);
});

/** The static draft plus one route a model proposed (a typo in the feature), checked by Construct like any route. */
function withModelRoute(root, request) {
  const d = staticDraft(root, request, { records: [] });
  const base = d.routes.find((r) => r.template === 'base-on');
  const model = { ...base, id: 'model:1', via: 'model', template: 'base-on', steps: [{ tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'ordrs', name: 'StatusBadge' } }], delta: [], unpredicted: true, status: 'unverified', ask: null };
  d.routes.push(...verifyRoutes(root, [model], d.bindings));
  return d;
}

test('drafter: a model route Construct refused is repaired once, checked on a copy, and added as a waiting step; nothing is written before approval', async () => {
  const dir = makeTempDir('line-im2-draft-');
  try {
    fs.cpSync(SAMPLE, dir, { recursive: true });
    const plan = createLinePlanService({ root: dir });
    const records = [];
    const repair = createRepairer(dir, { where: 'drafter', write: (l) => records.push(JSON.parse(l)), propose: async (q) => JSON.stringify({ tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' } }) });
    const drafter = createPlanDrafter({ root: dir, plan, enabled: true, record: false, draftFn: withModelRoute, repair });
    const view = await drafter.draft('add a badge to the orders feature');
    const r = view.routes.find((x) => x.id === 'model:1');
    assert.equal(r.status, 'ok');
    assert.equal(r.repair.outcome, 'repaired');
    assert.match(r.repair.sentence, /^The local model repaired the change from Construct's error, and Construct accepts it\.$/);
    assert.equal(records.length, 1, 'the attempt is kept in the plan records');
    assert.ok(!JSON.stringify(records[0]).includes('"orders"'), 'slotted');
    const added = await drafter.addRoute('add a badge to the orders feature', 'model:1', 'ui');
    assert.equal(added.ok, true, added.sentence);
    assert.ok(!fs.existsSync(path.join(dir, 'features/orders/components/StatusBadge.tsx')), 'nothing written before approval');
    const step = (await plan.view()).steps.find((s) => s.id === added.stepId);
    const { expect: _e, ...args } = step.args;
    assert.deepEqual(args, { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('drafter: with Ollama not running the model route stays refused, the static routes are unchanged, and one sentence says why', async () => {
  const down = createRepairer(SAMPLE, { record: false, propose: (q) => ollamaPropose({ ...q, fetch: /** @type {any} */ (async () => { throw new Error('ECONNREFUSED'); }) }) });
  const plan = { addStep: async () => ({ ok: false }), view: async () => ({}) };
  const on = await createPlanDrafter({ root: SAMPLE, plan, enabled: true, record: false, draftFn: withModelRoute, repair: down }).draft('add a badge to the orders feature');
  const off = await createPlanDrafter({ root: SAMPLE, plan, enabled: true, record: false, draftFn: withModelRoute, repair: false }).draft('add a badge to the orders feature');
  const r = on.routes.find((x) => x.id === 'model:1');
  assert.equal(r.status, 'refused');
  assert.equal(r.repair.sentence, 'The local model qwen2.5-coder:7b is not running, so Line did not try a repair and the static path is unchanged.');
  assert.deepEqual(on.routes.filter((x) => x.via !== 'model').map((x) => [x.id, x.status]), off.routes.filter((x) => x.via !== 'model').map((x) => [x.id, x.status]));
  assert.equal(on.recommended, off.recommended);
});
