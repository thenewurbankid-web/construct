// cp1 -- Line actions as plan steps: the one registry (line.* + construct.*), the gap before a step runs, the checks
// after it, the plan service on both stores (@mx/plan linked, and Line's built-in store when the link is down), and
// the person-only approval. Runs on copies of examples/line-sample with the real engine operations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { linkStatus } from '../packages/line-links/index.mjs';
import { createMockPlanRunner } from '../packages/line-links/mocks.mjs';
import { assertPlanView, assertLineStepResult, LINE_PLAN_TOOLS } from '../packages/engine/line/contract.mjs';
import { createLinePlanRegistry, gapOf, runChange, DEFAULT_EXPECT, REAL_PLAN_OPS } from '../packages/engine/line/planTools.mjs';
import { createLinePlanService, loadPlanApi, SESSION_ID } from '../packages/engine/line/planService.mjs';
import { createAtomicPlanWriter, createStaticPlanApi } from '../packages/engine/line/planFallback.mjs';
import { commandPlanRegistry } from '../packages/core/plan-registry.mjs';
import { createCommandRegistry } from '../packages/core/command-registry.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/line-sample');
const BADGE = { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' };
const BADGE_FILE = 'features/orders/components/StatusBadge.tsx';
const copy = () => { const dir = makeTempDir('line-plan-'); fs.cpSync(SAMPLE, dir, { recursive: true }); return dir; };
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const MISSING_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };
const staticLoad = (o) => loadPlanApi({ ...o, linkOptions: MISSING_LINK });
const linked = linkStatus().packages.find((p) => p.name === '@mx/plan')?.ok ? false : 'the @mx/plan link is not ready on this machine';

test('registry: one registry lists the line tools and the construct commands, with the right read/write marks', async () => {
  const commands = createCommandRegistry();
  commands.register({ name: 'validate', summary: 'Validate.', handler: () => {} });
  const reg = createLinePlanRegistry({ root: copy(), commands: commandPlanRegistry(commands) });
  const kinds = Object.fromEntries(reg.list().map((t) => [t.name, t.kind]));
  assert.deepEqual(kinds, {
    'line.baseOn': 'write', 'line.promote': 'write', 'line.setPageProp': 'write', 'line.fix': 'write', 'line.setFragment': 'write',
    'line.setBase': 'write', 'line.moveFile': 'write', 'line.createLayout': 'write', 'line.amend': 'write', 'line.import.mark': 'write', 'line.import.toLibrary': 'write', 'line.import.toFeature': 'write', 'line.import.fix': 'write', 'line.import.save': 'write', 'line.import.undo': 'write',
    'line.import.extractService': 'write', 'line.import.extractDomain': 'write', 'line.import.extractUsecase': 'write', 'line.import.splitPage': 'write', 'line.import.extractWorkflow': 'write',
    'line.leaveAsIs': 'write', 'line.createFeature': 'write', 'line.addRoute': 'write', 'line.setCode': 'write', 'line.setLayoutSlot': 'write', 'line.useViaUsecase': 'write', 'line.extractExpression': 'write',
    'line.baseWorkflowOn': 'write', 'line.setWorkflowRole': 'write', 'line.addWorkflowTransition': 'write', 'line.removeWorkflowTransition': 'write', 'line.project': 'read', 'construct.validate': 'read',
  });
  assert.deepEqual(LINE_PLAN_TOOLS.map((t) => t.name).sort(), reg.list().filter((t) => t.name.startsWith('line.')).map((t) => t.name).sort(), 'the contract lists every line tool');
  await assert.rejects(reg.call('line.baseOn', { libraryId: 'components/Badge' }), /got arguments it cannot use: feature/);
  await assert.rejects(reg.call('line.nope', {}), /There is no tool named line\.nope\./);
  const project = await reg.call('line.project', {});
  assert.equal(project.isLine, true);
});

test('registry: the line tools fit the plan runner contract (mock runner): a write runs only via registry.call', async () => {
  const dir = copy();
  const runner = createMockPlanRunner(createLinePlanRegistry({ root: dir }));
  assert.equal(runner.add({ tool: 'line.baseOn', args: { ...BADGE }, kind: 'read' }), 'The tool line.baseOn is marked write.');
  assert.equal(runner.add({ tool: 'line.baseOn', args: { ...BADGE } }), null);
  assert.equal(exists(dir, BADGE_FILE), false, 'adding a step writes nothing');
  const s = await runner.runNext();
  assert.equal(s.status, 'done');
  assertLineStepResult(s.result);
  assert.equal(exists(dir, BADGE_FILE), true);
});

test('gap: before a step runs, each expected output is missing, partial or present; a present file narrows the step', () => {
  const dir = copy();
  assert.deepEqual(gapOf(dir, 'line.baseOn', BADGE).map((g) => [g.checkId, g.state]), [['validate', 'missing'], ['files', 'missing']]);
  const first = runChange(dir, 'line.baseOn', BADGE);
  assert.equal(first.needsYou, false, first.sentence);
  // A two-file change with one file already there as planned (a stand-in op; the real ones refuse a taken name).
  const two = { ...REAL_PLAN_OPS, planBaseOn: () => ({ summary: 'Creates A and B.', files: [{ path: 'features/orders/components/A.tsx', content: '// @line-base components/Badge\nexport const A = 1;\n' }, { path: 'features/orders/components/B.tsx', content: '// @line-base components/Badge\nexport const B = 1;\n' }] }) };
  fs.writeFileSync(path.join(dir, 'features/orders/components/A.tsx'), '// @line-base components/Badge\nexport const A = 1;\n');
  const partial = gapOf(dir, 'line.baseOn', BADGE, two).find((g) => g.checkId === 'files');
  assert.equal(partial.state, 'partial');
  assert.equal(partial.sentence, 'Already there: A.tsx; to do: B.tsx.');
  const narrowed = runChange(dir, 'line.baseOn', BADGE, two);
  assert.deepEqual(narrowed.apply.files, ['features/orders/components/B.tsx'], 'the file already there is not written again');
  assert.equal(gapOf(dir, 'line.baseOn', BADGE, two).find((g) => g.checkId === 'files').state, 'present');
  const skipped = runChange(dir, 'line.baseOn', BADGE, two);
  assert.deepEqual([skipped.apply.files, skipped.needsYou], [[], false]);
  assert.match(skipped.sentence, /^Nothing to save: creates A and B is already there\.$/);
  assert.equal(gapOf(dir, 'line.baseOn', BADGE)[0].sentence.includes('cannot run as it stands'), true, 'a request that no longer plans says why');
});

test('checks: a landed change passes both default checks; a change the plan cannot make needs you with options', () => {
  const dir = copy();
  const ok = runChange(dir, 'line.baseOn', BADGE);
  assertLineStepResult(ok);
  assert.deepEqual(ok.checks.map((c) => [c.checkId, c.ok]), [['validate', true], ['files', true]]);
  assert.match(ok.sentence, /^Saved\. Creates StatusBadge in feature orders/);
  const again = runChange(dir, 'line.baseOn', BADGE);
  assertLineStepResult(again);
  assert.equal(again.needsYou, true);
  assert.deepEqual(again.options.map((o) => o.id), ['retry', 'leave']);
  assert.match(again.sentence, /^This needs you: 0 of 2 checks passed\./);
  const stopped = runChange(dir, 'line.baseOn', { ...BADGE, retry: { of: 's1', passed: 0 } });
  assert.equal(stopped.stopped, true);
  assert.deepEqual(stopped.options.map((o) => o.id), ['leave'], 'no retry is offered once a retry did not improve');
  assert.match(stopped.sentence, /no more than before, so Line stopped and needs you/);
  const custom = runChange(copy(), 'line.baseOn', { ...BADGE, expect: [...DEFAULT_EXPECT, { id: 't', sentence: 'The types pass.', kind: 'types' }] });
  assert.equal(custom.passed, 2);
  assert.equal(custom.needsYou, true, 'a check Line cannot run yet is not claimed as passing');
});

for (const [name, load, skip] of [['built-in store (link down)', staticLoad, false], ['@mx/plan linked', undefined, linked]]) {
  test(`service, ${name}: Base on adds a waiting step, nothing is written before Approve, Approve + run writes it and the plan file`, { skip }, async () => {
    const dir = copy();
    const svc = createLinePlanService({ root: dir, commands: null, ...(load ? { load } : {}) });
    const empty = await svc.view();
    assertPlanView(empty);
    assert.equal(empty.store.linked, !load);
    assert.deepEqual(empty.steps, []);
    const added = await svc.addStep({ tool: 'line.baseOn', args: BADGE }, 'ui');
    assertPlanView(added);
    const step = added.steps.find((s) => s.id === added.stepId);
    assert.equal(step.state, 'waiting');
    assert.equal(step.sentence, 'Waiting for your approval: Creates StatusBadge in feature orders, based on the library Badge.');
    assert.deepEqual(step.gap.map((g) => g.state), ['missing', 'missing']);
    assert.equal(exists(dir, BADGE_FILE), false, 'nothing is written before Approve');
    assert.ok(exists(dir, `line/plans/${SESSION_ID}.json`), 'the plan file is in line/plans');
    const early = await svc.runNext('ui');
    assert.equal(early.ok, false);
    assert.match(early.sentence, /waits for a person to approve it/);
    const agentApprove = await svc.approve(added.stepId, 'agent');
    assert.equal(agentApprove.ok, false);
    assert.match(agentApprove.sentence, /only a person can approve a write/);
    assert.equal((await svc.approve(added.stepId, 'ui')).ok, true);
    const ran = await svc.runNext('agent');
    assertPlanView(ran);
    const done = ran.steps.find((s) => s.id === added.stepId);
    assert.equal(done.state, 'done');
    assert.match(done.sentence, /^Saved: Creates StatusBadge/);
    assert.equal(exists(dir, BADGE_FILE), true);
    const file = JSON.parse(fs.readFileSync(path.join(dir, `line/plans/${SESSION_ID}.json`), 'utf8'));
    assert.equal(file.plans[0].steps[0].status, 'done');
    assert.equal(file.plans[0].steps[0].result.passed, 2);
  });

  test(`service, ${name}: a refused request never joins the plan; a step that fails its checks needs you, blocks the plan, and a retry that does not improve stops`, { skip }, async () => {
    const dir = copy();
    const svc = createLinePlanService({ root: dir, commands: null, ...(load ? { load } : {}) });
    const taken = await svc.addStep({ tool: 'line.baseOn', args: { ...BADGE, name: 'OrderButton' } }, 'ui');
    assert.deepEqual([taken.ok, taken.code], [false, 'NAME_TAKEN']);
    const a = await svc.addStep({ tool: 'line.baseOn', args: BADGE }, 'ui');
    fs.writeFileSync(path.join(dir, BADGE_FILE), '// someone else wrote this\n');
    const waiting = (await svc.view()).steps[0];
    assert.match(waiting.gap.find((g) => g.checkId === 'files').sentence, /cannot run as it stands: feature/);
    await svc.approve(a.stepId, 'ui');
    const ran = await svc.runNext('ui');
    const step = ran.steps[0];
    assert.equal(step.state, 'needs-you');
    assert.match(step.sentence, /^This needs you: 0 of 2 checks passed\./);
    assert.deepEqual(step.result.options.map((o) => o.id), ['retry', 'leave']);
    const other = await svc.addStep({ tool: 'line.project', args: {} }, 'agent');
    assert.equal(other.ok, true);
    const blocked = await svc.runNext('agent');
    assert.deepEqual([blocked.ok, blocked.code], [false, 'NEEDS_YOU']);
    const retry = await svc.addStep({ tool: 'line.baseOn', args: { retry: { of: a.stepId } } }, 'ui');
    assert.equal(retry.ok, true, retry.sentence);
    await svc.approve(retry.stepId, 'ui');
    const again = await svc.runNext('ui', retry.stepId);
    const second = again.steps.find((s) => s.id === retry.stepId);
    assert.equal(second.state, 'needs-you');
    assert.equal(second.result.stopped, true);
    assert.equal(again.steps[0].state, 'done', 'the first try is resolved by the retry');
    const no = await svc.addStep({ tool: 'line.baseOn', args: { retry: { of: retry.stepId } } }, 'ui');
    assert.deepEqual([no.ok, no.code], [false, 'STOPPED']);
    const leave = await svc.addStep({ tool: 'line.leaveAsIs', args: { stepId: retry.stepId } }, 'ui');
    await svc.approve(leave.stepId, 'ui');
    const left = await svc.runNext('ui', leave.stepId);
    assert.equal(left.ok, true, left.sentence);
    assert.match(left.steps.find((s) => s.id === retry.stepId).sentence, /^Left as it is in step/);
    const next = await svc.runNext('agent');
    assert.equal(next.ok, true, next.sentence);
  });
}

test('built-in store: same file and rules as @mx/plan (atomic write, person-only approval, versions)', async () => {
  const dir = makeTempDir('line-plan-store-');
  const api = createStaticPlanApi({ registry: createLinePlanRegistry({ root: copy() }), writer: createAtomicPlanWriter(dir), newId: () => 'x' });
  const c = await api.plan_create({ goal: 'Try it.', by: 'agent' });
  assert.equal(c.ok, true);
  const add = await api.plan_add_step({ planId: c.plan.id, version: c.plan.version, by: 'agent', step: { tool: 'line.project', args: {}, why: 'Read it.' } });
  assert.equal(add.ok, true);
  const stale = await api.plan_add_step({ planId: c.plan.id, version: 1, by: 'agent', step: { tool: 'line.project', args: {}, why: 'Read it.' } });
  assert.equal(stale.code, 'conflict');
  const bad = await api.plan_add_step({ planId: c.plan.id, version: add.plan.version, by: 'agent', step: { tool: 'line.project', args: {}, why: 'no capital' } });
  assert.equal(bad.code, 'invalid');
  const run = await api.plan_run_next({ planId: c.plan.id, version: add.plan.version, by: 'agent' });
  assert.equal(run.plan.steps[0].status, 'done', 'a read step runs without approval');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'line/plans')).sort(), ['ses-x.json', 'writes.jsonl']);
});

test('every Line write is a plan step: a typed fix (line.fix) and a code fragment (line.setFragment) run through the plan', async () => {
  const dir = copy();
  const svc = createLinePlanService({ root: dir, commands: null, load: staticLoad });
  const { withFixes, findingKey } = await import('../packages/engine/line/fixes.mjs');
  const { readLineProject } = await import('../packages/engine/line/model.mjs');
  const findings = withFixes(dir, readLineProject(dir).findings);
  const fixable = findings.find((f) => (f.fixes ?? []).some((x) => x.step));
  assert.ok(fixable, 'the sample has a finding with a typed fix');
  const fix = fixable.fixes.find((x) => x.step);
  const added = await svc.addStep({ tool: 'line.fix', args: { findingKey: findingKey(fixable), fixId: fix.id } }, 'ui');
  assert.equal(added.ok, true, added.sentence);
  assert.match(added.steps[0].sentence, /^Waiting for your approval: /);
  await svc.approve(added.stepId, 'ui');
  const ran = await svc.runNext('ui');
  assert.equal(ran.steps[0].state, 'done', ran.steps[0].sentence);
  const { listFragments } = await import('../packages/engine/line/fragments.mjs');
  const file = 'features/orders/pages/OrdersPage.tsx';
  const list = listFragments(dir, file);
  const frag = list.fragments[0];
  assert.ok(frag, 'the sample page has a fragment');
  const code = "() => console.log('Show every order')";
  const f = await svc.addStep({ tool: 'line.setFragment', args: { file, fragmentId: frag.id, code, contentHash: list.contentHash } }, 'ui');
  assert.equal(f.ok, true, f.sentence);
  assert.equal(fs.readFileSync(path.join(dir, file), 'utf8').includes('Show every order'), false, 'nothing written before Approve');
  await svc.approve(f.stepId, 'ui');
  const done = (await svc.runNext('ui')).steps.find((s) => s.id === f.stepId);
  assert.equal(done.state, 'done', done.sentence);
  assert.ok(fs.readFileSync(path.join(dir, file), 'utf8').includes('Show every order'));
});

/** cl1's case: OrdersPage's handler imports billing's InvoicesPage (LINE-DIR). */
async function refuseInvoicesImport(dir, svc) {
  const { listFragments } = await import('../packages/engine/line/fragments.mjs');
  const file = 'features/orders/pages/OrdersPage.tsx';
  const before = fs.readFileSync(path.join(dir, file), 'utf8');
  const list = listFragments(dir, file);
  const added = await svc.addStep({ tool: 'line.setFragment', args: { file, fragmentId: list.fragments[0].id, code: "() => import('../../billing/pages/InvoicesPage')", contentHash: list.contentHash } }, 'ui');
  await svc.approve(added.stepId, 'ui');
  const ran = await svc.runNext('ui');
  return { added, step: ran.steps.find((s) => s.id === added.stepId), file, before };
}

test('a change Construct refuses needs a fix: the recommended fix is one that would land (cl1: promote InvoicesPage is refused itself, so the chain promotes OrderButton first), in one approval', async () => {
  const dir = copy();
  const svc = createLinePlanService({ root: dir, commands: null, load: staticLoad });
  const { added, step, file, before } = await refuseInvoicesImport(dir, svc);
  assert.equal(step.state, 'needs-fix');
  assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), before, 'nothing written');
  const fix = step.result.options.find((o) => o.id === 'fix' && o.recommended);
  // Promoting InvoicesPage alone would be refused (the library page would use orders' OrderButton): the recommended fix
  // is the chain, carried with the refused change, as one step.
  assert.equal(fix.step.tool, 'line.amend');
  assert.deepEqual(fix.step.args.fixes, [{ tool: 'line.promote', args: { featureItemId: 'orders/components/OrderButton' } }, { tool: 'line.promote', args: { featureItemId: 'billing/pages/InvoicesPage' } }]);
  assert.equal(fix.step.args.change.tool, 'line.setFragment');
  assert.match(fix.sentence, /^First move OrderButton into the library, because InvoicesPage uses it; then move InvoicesPage\.tsx from feature billing into the library .*, together with the change Construct refused, in one step\.$/);
  assert.equal(step.result.apply.findings[0].fixes[0].id, 'LINE-DIR/promote', 'the finding carries Construct\'s typed fixes');
  // An agent's unrelated step is held; the fix for it (fixOf) is not.
  assert.equal((await svc.addStep({ tool: 'line.project', args: {} }, 'agent')).ok, true);
  const held = await svc.runNext('agent');
  assert.equal(held.code, 'NEEDS_YOU');
  assert.match(held.sentence, /Add (its fix|one of its \d+ fixes) \(options\[\]\.step\) with args\.fixOf/);
  const fixStep = await svc.addStep({ tool: fix.step.tool, args: { ...fix.step.args, fixOf: added.stepId } }, 'agent');
  assert.equal(fixStep.ok, true, fixStep.sentence);
  assert.equal((await svc.approve(fixStep.stepId, 'agent')).ok, false, 'an agent still cannot approve the fix');
  await svc.approve(fixStep.stepId, 'ui');
  const after = await svc.runNext('agent', fixStep.stepId);
  const fixed = after.steps.find((s) => s.id === fixStep.stepId);
  assert.equal(fixed.state, 'done', fixed.sentence);
  assert.equal(after.steps.find((s) => s.id === added.stepId).state, 'done', 'the refused change landed with its fix');
  assert.ok(fs.existsSync(path.join(dir, 'library/pages/InvoicesPage.tsx')) && fs.existsSync(path.join(dir, 'library/components/OrderButton.tsx')));
  assert.ok(fs.readFileSync(path.join(dir, file), 'utf8').includes('library/pages/InvoicesPage'), 'the new handler imports the library copy');
  const { validateLine } = await import('../packages/core/profiles/line/index.mjs');
  assert.deepEqual(validateLine(dir).violations.filter((v) => v.severity === 'error').map((v) => v.rule), ['LINE-BASE'], 'only the planted LINE-BASE is left');
});

test('cl1: when no fix would land, the step needs you, says so in one sentence, and offers no fix button', async () => {
  const dir = copy();
  // The library already has an OrderButton, so orders' OrderButton cannot be promoted, so InvoicesPage cannot be either.
  fs.copyFileSync(path.join(dir, 'library/components/Button.tsx'), path.join(dir, 'library/components/OrderButton.tsx'));
  const svc = createLinePlanService({ root: dir, commands: null, load: staticLoad });
  const { step, file, before } = await refuseInvoicesImport(dir, svc);
  assert.equal(step.state, 'needs-you', step.sentence);
  assert.match(step.sentence, /^This needs you: Construct refused the change, and none of its fixes would be accepted either, so Line cannot fix it on its own\. /);
  assert.equal(step.result.options.some((o) => o.id === 'fix' && o.step), false);
  const promote = step.result.apply.findings[0].fixes.find((x) => x.id === 'LINE-DIR/promote');
  assert.equal(promote.step, null);
  assert.match(promote.sentence, /; Construct would refuse that too, because the library file "library\/pages\/InvoicesPage\.tsx" imports .* from feature "orders"; the library must not depend on any feature, .*\.$/);
  assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), before);
});
