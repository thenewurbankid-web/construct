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
import { repairOnce, ollamaPropose } from '../packages/core/line-decide.mjs';
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

test('import fix loop: the fix jev picked is refused, the model repairs it once, the repaired fix waits for approval, lands, and the import ends', async () => {
  const asked = [];
  const repair = (option, refusal, c) => repairOnce(option, refusal, { check: c?.check ?? undefined, propose: async (q) => { asked.push(q.prompt); return JSON.stringify({ tool: option.tool, args: { ...option.args, args: { ...option.args.args, libraryId: 'components/AlertRowBase' } } }); } });
  const planService = createMockPlanService({ refuseFix: (s) => s.args.args?.libraryId === 'components/AlertRow' });
  const svc = createMockImportAgentService({ planService, reason: jev, repair });
  const agent = svc.agentFor(FOLDER);
  await agent.start('ui');
  let v = await agent.editStep('ui', { action: 'approve-all' });
  // The jev-picked fix waits for the person; approve it: Construct refuses it, and the model repairs it once.
  v = await approveAlong(agent, planService, v, 1);
  assert.equal(asked.length, 1, 'exactly one repair attempt');
  assert.match(asked[0], /^Construct refused this change\.\nError: Construct refused the fix: the library has no components\/AlertRow\./);
  const d = v.decisions.find((x) => x.id.startsWith('repair:'));
  assert.deepEqual([d.picked, d.by], ['repair', 'model']);
  assert.equal(v.waiting.for, 'approval', 'the repaired fix waits for a person');
  const repaired = planService.steps.find((s) => s.id === v.waiting.planStepId);
  assert.equal(repaired.args.args.libraryId, 'components/AlertRowBase');
  assert.equal(repaired.state, 'waiting', 'nothing runs before approval');
  v = await approveAlong(agent, planService, v);
  assert.equal(v.state, 'done', JSON.stringify(v.waiting));
  assert.equal(v.sentence, 'Done: 10 steps landed.');
});

test('import fix loop: the repair refused too goes to the person; a statically picked fix is never repaired', async () => {
  const repair = (option, refusal) => repairOnce(option, refusal, { propose: async () => JSON.stringify({ tool: option.tool, args: { ...option.args, args: { ...option.args.args, libraryId: 'components/Nope' } } }) });
  const planService = createMockPlanService({ refuseFix: () => true });
  const agent = createMockImportAgentService({ planService, reason: jev, repair }).agentFor(FOLDER);
  await agent.start('ui');
  let v = await agent.editStep('ui', { action: 'approve-all' });
  v = await approveAlong(agent, planService, v);
  assert.equal(v.waiting.for, 'answer');
  assert.match(v.waiting.sentence, /the local model's one repair of the fix was refused too: construct refused the fix: the library has no components\/Nope\./);
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
    assert.match(r.repair.sentence, /^The local model repaired the change once from Construct's error, and Construct accepts it\.$/);
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
  assert.equal(r.repair.sentence, 'The local model qwen2.5-coder:1.5b is not running, so Line did not try a repair and the static path is unchanged.');
  assert.deepEqual(on.routes.filter((x) => x.via !== 'model').map((x) => [x.id, x.status]), off.routes.filter((x) => x.via !== 'model').map((x) => [x.id, x.status]));
  assert.equal(on.recommended, off.recommended);
});
