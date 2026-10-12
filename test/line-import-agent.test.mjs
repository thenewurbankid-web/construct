// ci2 -- the Import agent (packages/engine/line/importAgent.mjs): a fixed typed process (xstate) scan -> classify -> plan
// -> review -> execute -> verify -> done, its state in <folder>/line/import-plan.json, decisions through Line's one
// decide() (construct.chooser off: the static order; construct.fix: the picker when it runs), execution only through cp1 plan steps a person approves, verify = validate --profile line +
// types + tests. First on the contract's mock (no disk), then on a temp copy of examples/import-sample with the real
// engine, the real plan service (built-in store) and the real writer; last on a copy of max-ai-ui when it is present.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { assertImportAgentView, assertImportPlanFile, IMPORT_PLAN_FILE, LINE_PLAN_TOOLS } from '../packages/engine/line/contract.mjs';
import { createImportAgent, nextState, decideWith, MAX_ROUNDS } from '../packages/engine/line/importAgent.mjs';
import { createImportAgentOnDisk } from '../packages/engine/line/importAgentDisk.mjs';
import { createMockImportAgentService, createMockPlanService, createMemoryStore } from '../packages/engine/line/mockImportAgent.mjs';
import { createMockImport } from '../packages/engine/line/mockImport.mjs';
import { createLinePlanService } from '../packages/engine/line/planService.mjs';
import { createLinePlanRegistry } from '../packages/engine/line/planTools.mjs';
import { verifyImport, lineBaseline } from '../packages/engine/line/importVerify.mjs';
import { createLogicOnDisk } from '../packages/engine/line/importLoopDisk.mjs';
import { readImportLoopRecords } from '../packages/engine/line/records.mjs';
import { jestHome, linkJestHome, NO_JEST_HOME } from '../test-utils/jestHome.mjs';
import { createMockDecide } from '../packages/core/line-decide-mock.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(REPO, 'examples/import-sample');
const FOLDER = 'src/alerts';
const TABLE_Q = `generic-name:${FOLDER}/components/Table.tsx`;

/** Approve every plan step the agent waits on (as the person), until it waits for something else. */
async function approveAlong(agent, planService, v, max = 40) {
  for (let i = 0; i < max && v.waiting?.for === 'approval'; i += 1) {
    const a = await planService.approve(v.waiting.planStepId, 'ui');
    assert.equal(a.ok, true, a.sentence);
    v = await agent.resume('ui');
    assertImportAgentView(v);
  }
  return v;
}

function hashes(dir, skip) {
  const out = {};
  const visit = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (r === skip || r.startsWith(`${skip}/`) || r === 'line') continue;
      if (e.isDirectory()) visit(path.join(abs, e.name), r);
      else out[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(abs, e.name))).digest('hex');
    }
  };
  visit(dir, '');
  return out;
}

// ------------------------------------------------------------------------------------------------- the process

test('process: the xstate machine allows only scan -> map -> characterize -> classify -> plan -> review -> execute -> verify -> done', () => {
  assert.equal(nextState('scan', 'SCANNED'), 'map');
  assert.equal(nextState('map', 'MAPPED'), 'characterize');
  assert.equal(nextState('characterize', 'CHARACTERIZED'), 'classify');
  assert.throws(() => nextState('map', 'CLASSIFIED'), /cannot go from "map"/);
  assert.equal(nextState('classify', 'CLASSIFIED'), 'plan');
  assert.equal(nextState('plan', 'PLANNED'), 'review');
  assert.equal(nextState('review', 'REVIEWED'), 'execute');
  assert.equal(nextState('execute', 'EXECUTED'), 'verify');
  assert.equal(nextState('verify', 'VERIFIED'), 'done');
  assert.equal(nextState('verify', 'FINISHED'), 'done');
  assert.throws(() => nextState('scan', 'REVIEWED'), /cannot go from "scan"/);
  assert.throws(() => nextState('review', 'EXECUTED'), /cannot go/);
  assert.throws(() => nextState('done', 'SCANNED'), /cannot go/);
});

test('contract: LINE_PLAN_TOOLS lists the import tools, and they are in the one registry', () => {
  const names = LINE_PLAN_TOOLS.map((t) => t.name);
  for (const t of ['line.import.mark', 'line.import.toLibrary', 'line.import.toFeature', 'line.import.fix']) assert.ok(names.includes(t), t);
  const reg = createLinePlanRegistry({ root: '/nowhere' });
  const fix = reg.list().find((t) => t.name === 'line.import.fix');
  assert.equal(fix.kind, 'write');
  assert.equal(reg.list().find((t) => t.name === 'line.import.toLibrary').schema.safeParse({ folder: '../x', name: 'A' }).success, false, 'a folder outside the project is refused');
  assert.equal(reg.list().find((t) => t.name === 'line.import.toLibrary').schema.safeParse({ folder: 'src/a', name: 'A', evil: 1 }).success, false, 'unknown args are refused');
  assert.equal(fix.schema.safeParse({ folder: 'src/a', tool: 'line.rm', args: {} }).success, false, 'only typed fix tools');
});

// ------------------------------------------------------------------------------------------------- on the mock

test('mock: start reads, sorts and plans the folder, then waits for the review; the Table question is decided by the static order', async () => {
  const svc = createMockImportAgentService();
  const agent = svc.agentFor(FOLDER);
  const v0 = await agent.view();
  assertImportAgentView(v0);
  assert.equal(v0.state, 'idle');
  const v = await agent.start('ui');
  assertImportAgentView(v);
  assert.equal(v.state, 'review');
  assert.equal(v.waiting.for, 'review');
  assert.equal(v.waiting.sentence, 'Review the plan: approve its 10 steps, or edit, skip or reorder them first.');
  assert.deepEqual(v.stages.map((s) => s.status), ['done', 'done', 'done', 'done', 'done', 'current', 'todo', 'todo', 'todo']);
  assert.equal(v.decisions.length, 1);
  assert.deepEqual([v.decisions[0].id, v.decisions[0].picked, v.decisions[0].by], [TABLE_Q, 'library', 'static']);
  assert.equal(svc.planService.steps.length, 0, 'nothing joins the plan before the review');
  assert.deepEqual(v.changes.map((c) => c.action), ['start', 'state', 'state', 'map', 'state', 'characterize', 'state', 'decide', 'classify', 'state', 'state', 'state']);
  assert.equal(v.logic.keptSentence, '11 of 11 logic units kept.');
  const again = await agent.start('ui');
  assert.equal(again.message, 'This import has already started; here it is.');
});

test('mock: edit, skip, reorder and approve are recorded with who did it; a bad change is one sentence and changes nothing', async () => {
  const agent = createMockImportAgentService().agentFor(FOLDER);
  await agent.start('ui');
  let v = await agent.editStep('agent', { action: 'edit', stepId: 'import-8-feature-AlertRow', args: { name: 'AlertLine' } });
  assertImportAgentView(v);
  const edited = v.steps.find((s) => s.id === 'import-8-feature-AlertRow');
  assert.equal(edited.sentence, 'Adds AlertLine to feature alerts, based on the library AlertRow.');
  assert.equal(v.changes.at(-1).by, 'agent');
  assert.equal(v.changes.at(-1).sentence, 'changed "Adds AlertRow to feature alerts, based on the library AlertRow" to "Adds AlertLine to feature alerts, based on the library AlertRow"; it needs approval again.');
  v = await agent.editStep('ui', { action: 'skip', stepId: 'import-5-lib-Table' });
  assert.equal(v.steps.find((s) => s.id === 'import-5-lib-Table').review, 'skipped');
  v = await agent.editStep('ui', { action: 'move', stepId: 'import-10-feature-AlertsPage', to: 1 });
  assert.equal(v.steps[1].id, 'import-10-feature-AlertsPage');
  assert.equal(v.changes.at(-1).sentence, 'moved "Adds AlertsPage to feature alerts, based on the library AlertsPage, serving /alerts" from place 10 to 2.');
  for (const [edit, code] of [
    [{ action: 'skip', stepId: 'import-1-mark' }, 'NEEDED'],
    [{ action: 'move', stepId: 'import-3-lib-AlertRow', to: 0 }, 'BAD_MOVE'],
    [{ action: 'edit', stepId: 'import-3-lib-AlertRow', args: { from: '../../etc/passwd' } }, 'NOT_EDITABLE'],
    [{ action: 'edit', stepId: 'import-3-lib-AlertRow', args: { level: 'planet' } }, 'BAD_ARGS'],
    [{ action: 'approve', stepId: 'nope' }, 'UNKNOWN_STEP'],
    [{ action: 'explode', stepId: 'import-1-mark' }, 'BAD_ACTION'],
  ]) {
    const before = JSON.stringify((await agent.view()).steps);
    const r = await agent.editStep('ui', edit);
    assert.equal(r.ok, false, JSON.stringify(edit));
    assert.equal(r.code, code);
    assert.match(r.sentence, /^\S.*[.?!]$/);
    assert.equal(JSON.stringify((await agent.view()).steps), before, 'a refused change changes nothing');
  }
});

test('mock: approving the plan runs it as cp1 plan steps; a refused step gets its top fix picked, the person approves the fix, the retry passes, and verify ends it', async () => {
  const svc = createMockImportAgentService();
  const agent = svc.agentFor(FOLDER);
  await agent.start('ui');
  let v = await agent.editStep('ui', { action: 'approve-all' });
  assertImportAgentView(v);
  assert.equal(v.state, 'execute');
  // Steps the person approved in the review ran; AlertRow's feature step was refused, and the fix waits for the person.
  assert.equal(v.waiting.for, 'approval');
  const fixStep = svc.planService.steps.find((s) => s.id === v.waiting.planStepId);
  assert.equal(fixStep.tool, 'line.import.fix');
  assert.equal(fixStep.args.fixOf, svc.planService.steps.find((s) => s.state === 'needs-fix').id);
  assert.equal(fixStep.state, 'waiting', 'an agent-picked fix is not approved for the person');
  const d = v.decisions.find((x) => x.id.startsWith('fix:'));
  assert.deepEqual([d.picked, d.by], ['set-base', 'static']);
  v = await approveAlong(agent, svc.planService, v);
  assert.equal(v.state, 'done');
  assert.equal(v.sentence, 'Done: 10 steps landed.');
  assert.equal(v.verify.ok, true);
  const row = v.steps.find((s) => s.id === 'import-8-feature-AlertRow');
  assert.equal(row.rounds, 1);
  assert.deepEqual(row.planStepIds.map((id) => svc.planService.steps.find((s) => s.id === id).tool), ['line.import.toFeature', 'line.import.fix', 'line.import.toFeature']);
  assert.ok(svc.planService.steps.every((s) => s.by === 'agent'), 'the agent adds every plan step');
  assert.ok(svc.planService.steps.every((s) => ['done', 'needs-fix'].includes(s.state)));
});

test('mock: a round that does not improve stops the loop and asks the person ONE question; "leave" carries on to done', async () => {
  const planService = createMockPlanService({ refuse: (s) => s.tool === 'line.import.toFeature' && s.args.name === 'AlertRow' });
  const svc = createMockImportAgentService({ planService });
  const agent = svc.agentFor(FOLDER);
  await agent.start('ui');
  let v = await agent.editStep('ui', { action: 'approve-all' });
  v = await approveAlong(agent, planService, v);
  assert.equal(v.waiting.for, 'answer');
  assert.equal(v.waiting.question.id, 'step:import-8-feature-AlertRow');
  assert.match(v.waiting.sentence, /^AlertRow needs you: trying again did not pass more checks than before\./);
  assert.deepEqual(v.waiting.question.options.map((o) => o.id), ['fix:set-base', 'leave']);
  const resumed = await agent.resume('ui');
  assert.equal(resumed.message, 'Answer the question first.', 'nothing moves until the question is answered');
  const wrong = await agent.answer('ui', 'step:import-8-feature-AlertRow', 'explode');
  assert.equal(wrong.code, 'BAD_OPTION');
  v = await agent.answer('ui', 'step:import-8-feature-AlertRow', 'leave');
  assertImportAgentView(v);
  v = await approveAlong(agent, planService, v);
  assert.equal(v.state, 'done', JSON.stringify([v.sentence, v.waiting, planService.steps.map((s) => [s.id, s.tool, s.state, s.args.stepId ?? s.args.retry?.of ?? s.args.fixOf])]));
  assert.equal(v.steps.find((s) => s.id === 'import-8-feature-AlertRow').run, 'left');
  assert.equal(v.sentence, 'Done: 9 steps landed, 1 left as it was.');
  assert.ok(MAX_ROUNDS >= 1);
});

test('mock: pause is kept in the file; a new agent on the same file resumes where it stopped', async () => {
  const store = createMemoryStore();
  const ops = createMockImport();
  const planService = createMockPlanService({ refuse: () => false });
  const make = () => createImportAgent({ root: '/mock', folder: FOLDER, planService, store, importOps: { scan: (_r, f) => ops.scan({ folder: f }), plan: (_r, f, a) => ops.plan({ folder: f, answers: a }) } });
  const a1 = make();
  await a1.start('ui');
  let v = await a1.pause('ui');
  assert.equal(v.paused, true);
  assert.equal(v.sentence, 'Paused at "Review"; resume to carry on.');
  v = await a1.editStep('ui', { action: 'approve-all' });
  assert.equal(v.state, 'review', 'a paused process does not run, even when approved');
  assertImportPlanFile(store.peek());
  assert.equal(store.peek().paused, true);
  const a2 = make();
  v = await a2.resume('ui');
  assert.equal(v.paused, false);
  assert.equal(v.state, 'done');
  assert.deepEqual(store.peek().changes.filter((c) => c.action === 'pause' || c.action === 'resume').map((c) => c.sentence), ['paused at review.', 'resumed at review.']);
});

test('decide: classify questions go through decide() (construct.chooser: off by default, the static order; turned on, the picker picks the Table answer and the plan follows it)', async () => {
  const off = await createMockImportAgentService({ decide: createMockDecide({ pick: 1 }).decide }).agentFor(FOLDER).start('ui');
  assert.deepEqual([off.decisions[0].picked, off.decisions[0].by], ['library', 'order'], 'construct.chooser ships off: the recommended option');
  const mock = createMockDecide({ pick: 1, on: ['construct.chooser'] });
  const agent = createMockImportAgentService({ decide: mock.decide }).agentFor(FOLDER);
  const v = await agent.start('ui');
  const d = v.decisions[0];
  assert.deepEqual([d.picked, d.by], ['feature:alerts', 'jev']);
  assert.ok(v.steps.some((s) => s.id.endsWith('feature-Table')), 'the plan keeps Table in feature alerts');
  assert.deepEqual(mock.picker.calls[0].length, 2, 'both options reach the picker, recommended first');
  const r = await decideWith(async () => { throw new Error('boom'); }, 'construct.chooser', 'Which?', ['a', 'b']);
  assert.deepEqual([r.picked, r.by], ['a', 'static']);
  const fix = await decideWith(createMockDecide().decide, 'construct.fix', 'Which fix?', ['f2', 'f1'], { sentence: 'Refused.', fixes: [{ id: 'f2', sentence: 'Two.', rank: 1 }, { id: 'f1', sentence: 'One.', rank: 2 }] });
  assert.deepEqual([fix.picked, fix.driver], ['f2', 'static'], 'construct.fix with the picker down: Construct\'s recommended fix');
  const none = await decideWith(null, 'q', 'Which?', ['a', 'b']);
  assert.equal(none.reason, 'Line took the recommended option, because no decision module answered.');
});

// ------------------------------------------------------------------------------------------------- real engine

function sampleCopy() {
  const dir = makeTempDir('construct-line-import-agent-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  // Cockpit opens a project by its architecture.yml; with it, validate on the folder names files from the project root
  // until the folder has its own (the verify baseline must still match them).
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\n');
  return dir;
}

test('real: on a copy of import-sample, the agent plans, waits for the person, lands every step through cp1 plan steps, writes only inside the folder, and verifies', async () => {
  const dir = sampleCopy();
  const outside = hashes(dir, FOLDER);
  const planService = createLinePlanService({ root: dir, commands: null });
  const agent = createImportAgentOnDisk({ root: dir, folder: FOLDER, planService, verify: verifyImport, baseline: lineBaseline });
  let v = await agent.start('ui');
  assert.equal(v.state, 'review');
  const file = path.join(dir, FOLDER, IMPORT_PLAN_FILE);
  assertImportPlanFile(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(fs.existsSync(path.join(dir, FOLDER, 'architecture.yml')), false, 'nothing but the plan file before approval');
  // The coding agent approves the review: its approval never approves a write, so the first plan step waits for the person.
  v = await agent.editStep('agent', { action: 'approve-all' });
  assert.equal(v.waiting.for, 'approval');
  assert.equal(fs.existsSync(path.join(dir, FOLDER, 'architecture.yml')), false, 'no write before a person approved it');
  const plan = await planService.view();
  assert.equal(plan.steps[0].tool, 'line.import.mark');
  assert.equal(plan.steps[0].state, 'waiting');
  v = await approveAlong(agent, planService, v);
  // Without jest in the app (this copy has no node_modules) Line cannot write characterization tests: every step kept
  // its logic, but at verify no unit has a test, so the owner must waive them (with jest: the tests below, no waiver).
  assert.equal(v.state, 'verify', v.sentence);
  assert.match(v.waiting.sentence, /^The checks found problems: 9 of 9 logic units still need a block or a test; the first: /);
  assert.deepEqual(v.waiting.question.options.map((x) => x.id), ['verify-again', 'waive']);
  assert.ok(v.logic.steps.length === 10 && v.logic.steps.every((s) => s.status === 'ok' && s.missing === 0), 'every step kept every unit');
  const refused = await agent.answer('agent', 'verify', 'waive');
  assert.deepEqual([refused.ok, refused.code], [false, 'OWNER_ONLY'], 'an agent never waives');
  v = await agent.answer('ui', 'verify', 'waive');
  assert.equal(v.state, 'done', v.sentence);
  assert.equal(v.sentence, 'Done: 10 steps landed.');
  assert.deepEqual(v.verify.checks.map((c) => [c.id, c.state]), [['validate', 'pass'], ['types', 'skipped'], ['tests', 'skipped'], ['char-tests', 'skipped'], ['logic-map', 'pass'], ['behaviour', 'pass'], ['imports', 'pass'], ['coverage', 'pass']]);
  assert.equal(v.verify.checks[0].sentence, 'Validate (profile line) finds no new problems in the folder. 2 problems were already there before the import.');
  assert.ok(fs.existsSync(path.join(dir, FOLDER, 'features/alerts/pages/AlertsPage.tsx')));
  assert.ok(fs.existsSync(path.join(dir, FOLDER, 'library/components/SeverityBadge.tsx')));
  assert.deepEqual(hashes(dir, FOLDER), outside, 'nothing outside the folder changed (the plan session lives in line/plans)');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assertImportPlanFile(saved);
  assert.equal(saved.state, 'done');
  assert.ok(saved.changes.filter((c) => c.action === 'add-step').length >= 10);
  const after = await planService.view();
  assert.ok(after.steps.every((s) => s.state === 'done'), 'every plan step ran');
  assert.ok(after.steps.every((s) => s.tool.startsWith('line.import.')));
});

// With the app's own jest (import-sample's jest.config.cjs and devDependencies, linked from a jest home), the
// characterizer pins src/alerts with generated tests before anything moves; they pass after every step, every unit has
// a block (the FitProposal) and a test, and the normal flow ends without a waiver.
const HOME = jestHome();
const SMALL = { budgetMs: 4000, componentBudgetMs: 8000, roundMs: 8000 };

test('real + jest: import-sample\'s folder import is pinned by generated characterization tests and ends without a waiver', { skip: !HOME && NO_JEST_HOME }, async () => {
  const dir = sampleCopy();
  linkJestHome(dir, /** @type {string} */ (HOME));
  const planService = createLinePlanService({ root: dir, commands: null });
  const agent = createImportAgentOnDisk({ root: dir, folder: FOLDER, planService, verify: verifyImport, baseline: lineBaseline, logic: createLogicOnDisk(dir, FOLDER, { characterize: SMALL }) });
  let v = await agent.start('ui');
  assert.equal(v.state, 'review', v.sentence);
  assert.ok(v.logic.testCount >= 6, `characterization tests were written (${v.logic.testCount})`);
  assert.equal(v.logic.tests.state, 'pass');
  assert.match(v.logic.fit.sentence, /^The logic fits \d+ blocks of feature alerts/);
  assert.ok(fs.readdirSync(path.join(dir, FOLDER, '__line_characterization__')).some((f) => f.endsWith('.char.test.tsx')));
  v = await agent.editStep('ui', { action: 'approve-all' });
  v = await approveAlong(agent, planService, v);
  assert.equal(v.state, 'done', v.sentence);
  assert.equal(v.sentence, 'Done: 10 steps landed.');
  assert.ok(v.logic.steps.every((s) => s.status === 'ok' && s.tests.state === 'pass'), 'the tests pass after every step');
  assert.deepEqual(v.verify.checks.map((c) => [c.id, c.state]), [['validate', 'pass'], ['types', 'pass'], ['tests', 'skipped'], ['char-tests', 'pass'], ['logic-map', 'pass'], ['behaviour', 'pass'], ['imports', 'pass'], ['coverage', 'pass']]);
  assert.equal(v.logic.waivers.length, 0, 'no waiver');
  assert.ok(!v.changes.some((c) => c.action === 'waive'));
});

test('real + jest: a route import (/alerts) also lands the FitProposal\'s extract steps and ends without a waiver', { skip: !HOME && NO_JEST_HOME }, async () => {
  const dir = sampleCopy();
  linkJestHome(dir, /** @type {string} */ (HOME));
  const planService = createLinePlanService({ root: dir, commands: null });
  const agent = createImportAgentOnDisk({ root: dir, folder: FOLDER, planService, verify: verifyImport, baseline: lineBaseline, logic: createLogicOnDisk(dir, FOLDER, { characterize: SMALL }) });
  let v = await agent.start('ui', { route: '/alerts' });
  assert.equal(v.state, 'review', v.sentence);
  const extract = v.steps.filter((s) => s.tool.startsWith('line.import.extract'));
  // import-sample has no xstate, so the screen flow stays for a person (said in the fit); the usecase lands.
  assert.deepEqual(extract.map((s) => [s.tool, s.args.name]), [['line.import.extractUsecase', 'useAlerts']]);
  v = await agent.editStep('ui', { action: 'approve-all' });
  v = await approveAlong(agent, planService, v);
  assert.equal(v.state, 'done', v.sentence);
  assert.ok(fs.existsSync(path.join(dir, FOLDER, 'library/usecases/useAlerts.ts')), 'the usecase block landed');
  assert.equal(v.verify.checks.find((c) => c.id === 'coverage').state, 'pass');
  assert.equal(v.logic.waivers.length, 0, 'no waiver');
  const { records } = readImportLoopRecords(dir);
  assert.equal(records.length, v.steps.length, 'one loop record per step, in records/import-loop.jsonl');
});

test('real: a step that cannot be made (an edited base that does not exist) asks one question; "leave" skips it and the rest lands', async () => {
  const dir = sampleCopy();
  const planService = createLinePlanService({ root: dir, commands: null });
  const agent = createImportAgentOnDisk({ root: dir, folder: FOLDER, planService, verify: verifyImport, baseline: lineBaseline });
  await agent.start('ui');
  await agent.editStep('ui', { action: 'edit', stepId: 'import-8-feature-AlertRow', args: { base: 'components/Nope' } });
  let v = await agent.editStep('ui', { action: 'approve-all' });
  v = await approveAlong(agent, planService, v);
  assert.equal(v.waiting?.for, 'answer', v.sentence);
  assert.equal(v.waiting.question.id, 'step:import-8-feature-AlertRow');
  assert.deepEqual(v.waiting.question.options.map((o) => o.id), ['undo', 'leave'], 'no typed fix: undoing the whole import comes first, leaving the step is the other choice');
  v = await agent.answer('ui', v.waiting.question.id, 'leave');
  v = await approveAlong(agent, planService, v);
  assert.equal(v.waiting?.question?.id, 'verify', v.sentence);
  v = await agent.answer('ui', 'verify', 'waive');
  assert.equal(v.state, 'done', v.sentence);
  assert.equal(v.steps.find((s) => s.id === 'import-8-feature-AlertRow').run, 'left');
  assert.equal(fs.existsSync(path.join(dir, FOLDER, 'features/alerts/components/AlertRow.tsx')), false);
});

const MAX_AI_UI = path.join(os.homedir(), 'Repositories/max-ai-ui');
test('real: a copy of max-ai-ui (when present) imports src/subframe-pages/Inbox; the original is never touched', { skip: !fs.existsSync(path.join(MAX_AI_UI, 'src/subframe-pages/Inbox')) && 'max-ai-ui is not on this machine' }, async () => {
  const dir = makeTempDir('construct-line-import-agent-max-');
  fs.cpSync(MAX_AI_UI, dir, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git|\.next|coverage|dist)([\\/]|$)/.test(src.slice(MAX_AI_UI.length)) });
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\n');
  const folder = 'src/subframe-pages/Inbox';
  const planService = createLinePlanService({ root: dir, commands: null });
  const agent = createImportAgentOnDisk({ root: dir, folder, planService, verify: verifyImport, baseline: lineBaseline });
  let v = await agent.start('ui');
  assert.equal(v.state, 'review');
  v = await agent.editStep('ui', { action: 'approve-all' });
  v = await approveAlong(agent, planService, v, 80);
  // The owner answers each question: the waiver when only a waiver can finish it, else the recommended option, but
  // leave a step rather than undo the whole import (undo is the other choice; not this test's).
  const pick = (q) => (q.options.some((x) => x.id === 'waive') ? 'waive' : q.recommended === 'undo' ? 'leave' : q.recommended);
  for (let i = 0; i < 5 && v.waiting?.for === 'answer'; i += 1) { v = await agent.answer('ui', v.waiting.question.id, pick(v.waiting.question)); v = await approveAlong(agent, planService, v, 80); }
  assert.equal(v.state, 'done', v.sentence);
  assert.ok(fs.existsSync(path.join(dir, folder, 'features/inbox')), 'InboxPage lands in feature inbox');
  assert.equal(fs.existsSync(path.join(MAX_AI_UI, 'architecture.yml')), false, 'the original is untouched');
  assert.equal(fs.existsSync(path.join(MAX_AI_UI, folder, 'line')), false, 'the original is untouched');
});
