// Line Import v2, the import loop (packages/engine/line/importLoop.mjs, docs/line/import-v2/CONTRACT.md step 5): after each
// import step a person approved, the Import agent rebuilds the logic map, diffs it, runs the characterization tests in the
// app's own runner and checks the moved files' behaviour (core check-change's path-mapped variant); it goes on only when
// every check passes, else it stops with ONE sentence plus typed fixes. Only a person waives a unit.
//
// The fixture app is a temp folder with one module and its node:test test; the steps are performed on disk by a small
// plan service, so the loop's real disk ops (importLoopDisk.mjs) do the mapping, the tests and the behaviour check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { assertImportAgentView, assertImportPlanFile, IMPORT_PLAN_FILE } from '../packages/engine/line/contract.mjs';
import { createImportAgent } from '../packages/engine/line/importAgent.mjs';
import { fileStore, createImportAgentOnDisk, snapshotFolder, rollbackFolder } from '../packages/engine/line/importAgentDisk.mjs';
import { createLogicOnDisk, readRouteFamily, buildLogicMap } from '../packages/engine/line/importLoopDisk.mjs';
import { compareLogicMaps } from '../packages/engine/line/logicMap.mjs';
import { createMockLogic } from '../packages/engine/line/importLoopMock.mjs';
import { createMockImportAgentService, createMockPlanService } from '../packages/engine/line/mockImportAgent.mjs';
import { readImportLoopRecords } from '../packages/engine/line/records.mjs';
import { createLinePlanService } from '../packages/engine/line/planService.mjs';
import { verifyImport, lineBaseline, checkBehaviour } from '../packages/engine/line/importVerify.mjs';
import { checkChangeForMove } from '../packages/core/check-change.mjs';
import { semanticDiffMapped } from '../packages/ast/semanticDiff.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FOLDER = 'src/calc';
const WITH_BRANCH = `export function total(items) {
  if (items.length === 0) return null;
  return items.reduce((sum, x) => sum + x, 0);
}
`;
const WITHOUT_BRANCH = `export function total(items) {
  return items.reduce((sum, x) => sum + x, 0);
}
`;
const TEST_AT = (spec) => `import test from 'node:test';
import assert from 'node:assert/strict';
import { total } from '${spec}';
test('total adds the items', () => { assert.equal(total([1, 2, 3]), 6); });
`;

/** The fixture app: src/calc/total.mjs (a pure function with one branch) and its node:test test. */
function fixtureApp({ failingTest = false } = {}) {
  const dir = makeTempDir('construct-line-import-loop-');
  fs.mkdirSync(path.join(dir, FOLDER), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"calc-app","type":"module","private":true}\n');
  fs.writeFileSync(path.join(dir, FOLDER, 'total.mjs'), WITH_BRANCH);
  fs.writeFileSync(path.join(dir, FOLDER, 'total.test.mjs'), failingTest ? TEST_AT('./total.mjs').replace('6);', '7);') : TEST_AT('./total.mjs'));
  return dir;
}

/** The one import step: total moves into the library; `drop` loses its branch on the way. */
const STEP = { id: 'import-1-lib-total', tool: 'line.import.toLibrary', args: { folder: FOLDER, from: 'total.mjs', kind: 'workflows', name: 'total', keepShim: false }, sentence: 'Moves total into the library and points its users at it.' };
function landOnDisk(dir, { drop }) {
  const to = path.join(dir, FOLDER, 'library/workflows/total.mjs');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, drop ? WITHOUT_BRANCH : fs.readFileSync(path.join(dir, FOLDER, 'total.mjs'), 'utf8'));
  fs.rmSync(path.join(dir, FOLDER, 'total.mjs'));
  fs.writeFileSync(path.join(dir, FOLDER, 'total.test.mjs'), TEST_AT('./library/workflows/total.mjs'));
}

/** The loop's real disk ops, with the app's own node:test test as its characterization test (the app has no jest). */
const logicOf = (dir) => createLogicOnDisk(dir, FOLDER, {
  characterizeWith: async (_root, _folder, _closure, map) => ({ tests: [{ file: `${FOLDER}/total.test.mjs`, runner: 'jest', kind: 'pure', unitFingerprints: map.units.map((u) => u.fingerprint), title: 'total.test.mjs' }], sentence: 'The app\'s own test pins total.' }),
});

/** The agent on the fixture: real loop ops on disk, a plan service that performs the step on disk when it runs. */
function fixtureAgent(dir, { drop = false, undo = false } = {}) {
  const planService = createMockPlanService({ refuse: () => false });
  const runNext = planService.runNext;
  planService.runNext = async (by, id) => {
    const s = planService.steps.find((x) => x.id === id);
    const r = await runNext(by, id);
    if (r.ok && s?.tool === 'line.import.toLibrary' && s.state === 'done') landOnDisk(dir, { drop });
    return r;
  };
  const importOps = { scan: () => ({ found: [], questions: [] }), plan: () => ({ steps: [STEP], summary: 'Brings total into Line in 1 step.' }) };
  const agent = createImportAgent({ root: dir, folder: FOLDER, planService, store: fileStore(dir, FOLDER), importOps, logic: logicOf(dir), ...(undo ? { snapshot: snapshotFolder, rollback: rollbackFolder } : {}) });
  return { agent, planService };
}

async function approveAlong(agent, planService, v) {
  for (let i = 0; i < 20 && v.waiting?.for === 'approval'; i += 1) {
    assert.equal((await planService.approve(v.waiting.planStepId, 'ui')).ok, true);
    v = await agent.resume('ui');
    assertImportAgentView(v);
  }
  return v;
}

// ------------------------------------------------------------------------------------------------- the loop on disk

test('map and characterize: the unmodified app is mapped and its tests pass before anything moves; the map lands in <folder>/line/', async () => {
  const dir = fixtureApp();
  const { agent } = fixtureAgent(dir);
  const v = await agent.start('ui');
  assertImportAgentView(v);
  assert.equal(v.state, 'review');
  assert.deepEqual(v.stages.slice(0, 3).map((s) => [s.id, s.status]), [['scan', 'done'], ['map', 'done'], ['characterize', 'done']]);
  assert.equal(v.logic.units, 2, 'the export and the branch');
  assert.equal(v.logic.testCount, 1);
  assert.equal(v.logic.tests.state, 'pass');
  assert.equal(v.logic.keptSentence, '2 of 2 logic units kept.');
  const map = JSON.parse(fs.readFileSync(path.join(dir, FOLDER, 'line/logic-map.json'), 'utf8'));
  assert.deepEqual(map.units.map((u) => [u.kind, u.fn, u.detail]), [['export', '<module>', 'function total'], ['branch', 'total', 'if (items.length === 0)']]);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, FOLDER, 'line/import-baseline.json'), 'utf8')).sources[`${FOLDER}/total.mjs`].includes('return null'));
});

test('a step that keeps every unit continues to done; a step that drops a branch is stopped with one sentence and typed fixes', async () => {
  const keep = fixtureApp();
  const a = fixtureAgent(keep);
  await a.agent.start('ui');
  let v = await a.agent.editStep('ui', { action: 'approve-all' });
  v = await approveAlong(a.agent, a.planService, v);
  assert.equal(v.state, 'done', v.sentence);
  assert.equal(v.logic.steps[0].status, 'ok');
  assert.equal(v.logic.steps[0].sentence, 'After "Moves total into the library and points its users at it", every check passes: 2 of 2 logic units kept (2 moved).');
  assert.deepEqual(v.verify.checks.filter((c) => ['char-tests', 'logic-map', 'behaviour', 'coverage'].includes(c.id)).map((c) => [c.id, c.state]), [['char-tests', 'pass'], ['logic-map', 'pass'], ['behaviour', 'pass'], ['coverage', 'pass']]);

  const drop = fixtureApp();
  const b = fixtureAgent(drop, { drop: true });
  await b.agent.start('ui');
  v = await b.agent.editStep('ui', { action: 'approve-all' });
  v = await approveAlong(b.agent, b.planService, v);
  assert.equal(v.state, 'execute', 'the loop stopped before verify');
  assert.equal(v.waiting.for, 'answer');
  assert.equal(v.waiting.sentence, `Step 1 stopped the import: 1 logic unit went missing; the first: the branch "if (items.length === 0)" in total (${FOLDER}/total.mjs:2) is missing after the import.`);
  // The typed fix comes first: the extract step of the unit's FitProposal block (a domain), from where its file moved.
  assert.deepEqual(v.waiting.question.options.map((o) => o.id), ['fix:1', 'recheck', 'waive']);
  const typed = v.waiting.question.options[0];
  assert.equal(typed.sentence, 'Put the branch "if (items.length === 0)" of total back: moves total of total.mjs into the domain total in the library.');
  assert.deepEqual(typed.step, { tool: 'line.import.extractDomain', args: { folder: FOLDER, from: 'library/workflows/total.mjs', names: ['total'], name: 'total' } });
  assert.equal(v.waiting.question.options[1].sentence, `Put the old logic of ${FOLDER}/total.mjs back into ${FOLDER}/library/workflows/total.mjs, then check again.`);
  const st = v.logic.steps[0];
  assert.equal(st.status, 'stopped');
  assert.equal(st.missing, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(drop, FOLDER, IMPORT_PLAN_FILE), 'utf8'));
  assertImportPlanFile(saved);
  const loop = saved.logic.loop[0];
  // Each failing check carries its typed fixes: put the lost branch back or the owner waives it; put the file's old logic back or the owner accepts it.
  assert.deepEqual(loop.fixes.map((f) => [f.id, f.ownerOnly ?? false]), [['put-back', false], ['waive', true], ['put-back', false], ['waive', true]]);
  assert.deepEqual(loop.checks.map((c) => [c.id, c.state]), [['char-tests', 'pass'], ['logic-map', 'fail'], ['behaviour', 'fail'], ['imports', 'pass']]);

  // Picking the typed fix adds it as a plan step the person approved here; once it lands the step is checked again (the
  // branch is still gone, so the loop asks again: moving code cannot bring back code that was lost).
  const plannedBefore = b.planService.steps.length;
  v = await b.agent.answer('ui', v.waiting.question.id, 'fix:1');
  const added = b.planService.steps.slice(plannedBefore);
  assert.deepEqual(added.map((s) => s.tool), ['line.import.extractDomain']);
  v = await approveAlong(b.agent, b.planService, v);
  assert.equal(v.waiting?.for, 'answer', v.sentence);
  assert.equal(v.waiting.question.id, 'loop:import-1-lib-total');
  assert.ok(v.changes.some((c) => c.action === 'loop' && /the put-back step landed/.test(c.sentence)));
  assert.equal(v.logic.steps.length, 2, 'the step was checked again after the fix landed');

  // The person puts the branch back; "check again" re-runs the loop, it passes, and the import goes on to done.
  fs.writeFileSync(path.join(drop, FOLDER, 'library/workflows/total.mjs'), WITH_BRANCH);
  v = await b.agent.answer('ui', v.waiting.question.id, 'recheck');
  assert.equal(v.state, 'done', v.sentence);
  assert.equal(v.logic.steps.at(-1).status, 'ok');
});

test('iv2-bugs undo with the loop: a step the loop stops can undo the whole import; the folder is back byte for byte', async () => {
  const dir = fixtureApp();
  const before = fs.readFileSync(path.join(dir, FOLDER, 'total.mjs'), 'utf8');
  const { agent, planService } = fixtureAgent(dir, { drop: true, undo: true });
  await agent.start('ui');
  let v = await agent.editStep('ui', { action: 'approve-all' });
  v = await approveAlong(agent, planService, v);
  assert.equal(v.waiting.question.id, 'loop:import-1-lib-total');
  assert.deepEqual(v.waiting.question.options.map((o) => o.id), ['fix:1', 'recheck', 'undo', 'waive']);
  assert.equal(v.waiting.question.options[2].sentence, `Undo the import: put ${FOLDER} back as it was before it started (1 step landed).`);
  v = await agent.answer('ui', 'loop:import-1-lib-total', 'undo');
  assert.equal(v.state, 'done', v.sentence);
  assert.equal(v.sentence, `Undone: ${FOLDER} is back as it was before the import; nothing of it stayed.`);
  assert.equal(fs.readFileSync(path.join(dir, FOLDER, 'total.mjs'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, FOLDER, 'library')), false, 'what the step wrote is gone');
  assert.ok(fs.existsSync(path.join(dir, FOLDER, 'line/logic-map.json')), 'Line\'s own state stays');
  assertImportPlanFile(JSON.parse(fs.readFileSync(path.join(dir, FOLDER, IMPORT_PLAN_FILE), 'utf8')));
});

test('waivers: an agent\'s waiver is refused and changes nothing; the owner\'s waiver lets the step through', async () => {
  const dir = fixtureApp();
  const { agent, planService } = fixtureAgent(dir, { drop: true });
  await agent.start('ui');
  let v = await agent.editStep('ui', { action: 'approve-all' });
  v = await approveAlong(agent, planService, v);
  const q = v.waiting.question.id;
  const before = fs.readFileSync(path.join(dir, FOLDER, IMPORT_PLAN_FILE), 'utf8');
  const refused = await agent.answer('agent', q, 'waive');
  assert.deepEqual([refused.ok, refused.code], [false, 'OWNER_ONLY']);
  assert.equal(refused.sentence, 'Only a person can waive a logic unit; an agent never can. Ask the owner to decide in Cockpit.');
  assert.equal(fs.readFileSync(path.join(dir, FOLDER, IMPORT_PLAN_FILE), 'utf8'), before, 'a refused waiver writes nothing');
  v = await agent.answer('ui', q, 'waive');
  assert.equal(v.state, 'done', v.sentence);
  assert.equal(v.logic.waivers.length, 2, 'the lost branch and the file\'s changed behaviour');
  assert.ok(v.logic.waivers.every((w) => w.by === 'owner'));
  assert.equal(v.verify.checks.find((c) => c.id === 'logic-map').state, 'pass');
  assert.match(v.verify.checks.find((c) => c.id === 'logic-map').sentence, /the owner waived/);
  assert.deepEqual(v.changes.filter((c) => c.action === 'waive').map((c) => c.by), ['ui']);
  // A plan file that claims an agent's waiver is refused by the contract.
  const doc = JSON.parse(fs.readFileSync(path.join(dir, FOLDER, IMPORT_PLAN_FILE), 'utf8'));
  doc.logic.waivers[0].by = 'agent';
  assert.throws(() => assertImportPlanFile(doc), /an agent never waives/);
});

test('characterize: a test that fails on the unmodified app stops before anything moves; fixing it carries on', async () => {
  const dir = fixtureApp({ failingTest: true });
  const { agent } = fixtureAgent(dir);
  let v = await agent.start('ui');
  assert.equal(v.state, 'characterize');
  assert.equal(v.waiting.sentence, '1 of 1 characterization tests fail on the app before anything moved, so they cannot prove its behaviour is kept; the first: total.test.mjs.');
  assert.deepEqual(v.waiting.question.options.map((o) => o.id), ['recheck', 'waive']);
  assert.equal((await agent.answer('agent', 'characterize', 'waive')).code, 'OWNER_ONLY');
  fs.writeFileSync(path.join(dir, FOLDER, 'total.test.mjs'), TEST_AT('./total.mjs'));
  v = await agent.answer('ui', 'characterize', 'recheck');
  assert.equal(v.state, 'review', v.sentence);
  assert.equal(v.logic.tests.state, 'pass');
});

test('the disk state resumes: a new agent on the same folder carries on from the file, and each step leaves a slotted loop record', async () => {
  const dir = fixtureApp();
  const first = fixtureAgent(dir);
  await first.agent.start('ui');
  await first.agent.pause('ui');
  // A new agent (a server restart): same folder, same file, the baseline map read back from <folder>/line/.
  const planService = first.planService;
  const importOps = { scan: () => { throw new Error('a resumed import does not scan again'); }, plan: () => { throw new Error('nor plan again'); } };
  const again = createImportAgent({ root: dir, folder: FOLDER, planService, store: fileStore(dir, FOLDER), importOps, logic: logicOf(dir) });
  let v = await again.view();
  assert.equal(v.paused, true);
  assert.equal(v.logic.units, 2);
  v = await again.resume('ui');
  v = await again.editStep('ui', { action: 'approve-all' });
  v = await approveAlong(again, planService, v);
  assert.equal(v.state, 'done', v.sentence);
  assert.equal(v.logic.steps[0].moved, 2);
  const { records, skipped } = readImportLoopRecords(dir);
  assert.equal(skipped, 0);
  assert.equal(records.length, 1);
  const r = records[0];
  assert.deepEqual([r.kind, r.status, r.diff.moved, r.tests.passed], ['import-loop', 'ok', 2, 1]);
  assert.doesNotMatch(JSON.stringify(r).replace(/"total":/g, ''), /\btotal\b|\bcalc\b/, 'no project word is stored (a "total" field is the record\'s own)');
});

// ------------------------------------------------------------------------------------------------- the behaviour check

test('path-mapped check-change: a moved pure function whose imports were rewritten is same-behaviour; a changed one is changed', () => {
  const dir = makeTempDir('construct-line-check-move-');
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const before = "import { round } from './round';\nexport function total(a, b) { return round(a + b); }\n";
  write('src/calc/library/domain/total.ts', "import { round } from '../../round';\nexport function total(a, b) { return round(a + b); }\n");
  const moves = { 'src/calc/total': 'src/calc/library/domain/total' };
  const same = checkChangeForMove(dir, 'src/calc/total.ts', 'src/calc/library/domain/total.ts', { beforeSource: before, moves });
  assert.deepEqual([same.verdict, same.from, same.file], ['same-behaviour', 'src/calc/total.ts', 'src/calc/library/domain/total.ts']);
  assert.equal(semanticDiffMapped(before, fs.readFileSync(path.join(dir, 'src/calc/library/domain/total.ts'), 'utf8'), { beforeFile: 'src/calc/total.ts', afterFile: 'src/calc/library/domain/total.ts', moves }).verdict, 'same-behaviour');

  // Moved and changed: a - b is not a + b; fast-check finds the counter-example.
  write('src/calc/library/domain/sum.ts', 'export const sum = (a: number, b: number) => a - b;\n');
  const changed = checkChangeForMove(dir, 'src/calc/sum.ts', 'src/calc/library/domain/sum.ts', { beforeSource: 'export const sum = (a: number, b: number) => a + b;\n', moves: { 'src/calc/sum': 'src/calc/library/domain/sum' } });
  assert.equal(changed.verdict, 'changed');
  assert.equal(changed.propertyCheck.checked[0].verdict, 'diverged');

  // Moved and rewritten but equivalent (b + a): the AST differs, fast-check proves the pure export the same.
  write('src/calc/library/domain/add.ts', 'export const add = (a: number, b: number) => b + a;\n');
  const equivalent = checkChangeForMove(dir, 'src/calc/add.ts', 'src/calc/library/domain/add.ts', { beforeSource: 'export const add = (a: number, b: number) => a + b;\n', moves: {} });
  assert.deepEqual([equivalent.verdict, equivalent.operations], ['same-behaviour', ['equivalent']]);
});

// Found on contact-manager-ui (2026-10-12): extractService moved fetchData out of hooks.ts, which keeps its hooks; the
// whole old hooks.ts was compared with the new fetchData.ts alone and the step stopped as "behaves differently".
test('behaviour check: an extract step that splits a file (part moved, the rest stays) is same-behaviour; a body changed on the way is not', () => {
  const dir = makeTempDir('construct-line-check-split-');
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const before = "import { useState } from 'react';\nexport function useThing() { const [d, setD] = useState(null); fetchData('/x', setD); return d; }\nfunction fetchData(url, set) { fetch(url).then((r) => r.json()).then(set); }\n";
  write('src/app/hooks.ts', "import { useState } from 'react';\nimport { fetchData } from '../features/home/services/fetchData';\nexport function useThing() { const [d, setD] = useState(null); fetchData('/x', setD); return d; }\n");
  write('src/features/home/services/fetchData.ts', '// Line Import (line.import.extractService): moved here from app/hooks.ts.\n\nexport function fetchData(url, set) { fetch(url).then((r) => r.json()).then(set); }\n');
  const diff = { moved: [{ from: { file: 'src/app/hooks.ts', kind: 'io' }, to: { file: 'src/features/home/services/fetchData.ts' } }] };
  const [same] = checkBehaviour(dir, diff, { 'src/app/hooks.ts': before }, 'src');
  assert.deepEqual([same.from, same.to, same.verdict], ['src/app/hooks.ts', 'src/features/home/services/fetchData.ts', 'same-behaviour']);
  write('src/features/home/services/fetchData.ts', 'export function fetchData(url, set) { fetch(url).then((r) => r.text()).then(set); }\n');
  const [changed] = checkBehaviour(dir, diff, { 'src/app/hooks.ts': before }, 'src');
  assert.equal(changed.verdict, 'changed');
});

test('compareLogicMaps: a move is kept (moved), a lost unit is missing, an edited one is changed', () => {
  const dir = fixtureApp();
  const before = buildLogicMap(dir, [`${FOLDER}/total.mjs`]);
  landOnDisk(dir, { drop: false });
  const moved = compareLogicMaps(before, buildLogicMap(dir, [`${FOLDER}/library/workflows/total.mjs`]));
  assert.deepEqual([moved.kept.length, moved.moved.length, moved.missing.length, moved.changed.length], [0, 2, 0, 0]);
  fs.writeFileSync(path.join(dir, FOLDER, 'library/workflows/total.mjs'), WITH_BRANCH.replace('items.length === 0', 'items.length < 1'));
  const edited = compareLogicMaps(before, buildLogicMap(dir, [`${FOLDER}/library/workflows/total.mjs`]));
  assert.equal(edited.changed.length, 1);
  assert.equal(edited.changed[0].sentence, 'The branch in total changed from "if (items.length === 0)" to "if (items.length < 1)".');
  fs.writeFileSync(path.join(dir, FOLDER, 'library/workflows/total.mjs'), WITHOUT_BRANCH);
  assert.equal(compareLogicMaps(before, buildLogicMap(dir, [`${FOLDER}/library/workflows/total.mjs`])).missing[0].detail, 'if (items.length === 0)');
});

// ------------------------------------------------------------------------------------------------- a route as input

test('route input: readRouteFamily reads /alerts and its sub-route; the agent started with a route maps the route\'s closure', async () => {
  const dir = makeTempDir('construct-line-import-route-');
  fs.cpSync(path.join(REPO, 'examples/import-sample'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\n');
  const closure = readRouteFamily(dir, '/alerts');
  assert.deepEqual(closure.routes.map((r) => [r.route, r.entry]), [['/alerts', 'src/alerts/pages/AlertsPage.tsx'], ['/alerts/:id', 'src/alerts/pages/AlertDetailPage.tsx']]);
  assert.ok(closure.files.includes('src/ui/Card.tsx'), 'the closure crosses the folder: the page uses the app\'s Card');
  assert.ok(closure.files.includes('src/alerts/components/Table.tsx'));
  assert.throws(() => readRouteFamily(dir, '/nowhere'), /^LineOpError: The app has no route \/nowhere; its routes start with \/alerts\.$/);
  const planService = createLinePlanService({ root: dir, commands: null });
  const agent = createImportAgentOnDisk({ root: dir, folder: 'src/alerts', planService, verify: verifyImport, baseline: lineBaseline });
  const v = await agent.start('ui', { route: '/alerts' });
  assert.equal(v.state, 'review', v.sentence);
  assert.equal(v.logic.route, '/alerts');
  assert.equal(v.logic.files, closure.files.length);
  assert.match(v.logic.sentence, /^Route \/alerts: \d+ logic units in \d+ files; \d+ of \d+ kept\.$/);
});

// ------------------------------------------------------------------------------------------------- the mock

test('mock: a planted lost unit stops the loop in Cockpit\'s mock mode too; the screen data says how many units were kept', async () => {
  const logic = createMockLogic({ dropOn: (tool, args) => tool === 'line.import.toLibrary' && args.name === 'Table' });
  const svc = createMockImportAgentService({ logic, planService: createMockPlanService({ refuse: () => false }) });
  const agent = svc.agentFor('src/alerts');
  await agent.start('ui');
  let v = await agent.editStep('ui', { action: 'approve-all' });
  for (let i = 0; i < 20 && v.waiting?.for === 'approval'; i += 1) { await svc.planService.approve(v.waiting.planStepId, 'ui'); v = await agent.resume('ui'); }
  assert.equal(v.waiting.question.id, 'loop:import-5-lib-Table');
  assert.equal(v.waiting.sentence, 'Step 5 stopped the import: 1 logic unit went missing; the first: the conditional render "rows.length === 0" in Table (src/alerts/components/Table.tsx:1) is missing after the import.');
  assert.equal(v.logic.keptSentence, '10 of 11 logic units kept.');
  assert.equal(v.logic.missing.length, 1);
  logic.restore();
  v = await agent.answer('ui', v.waiting.question.id, 'recheck');
  for (let i = 0; i < 20 && v.waiting?.for === 'approval'; i += 1) { await svc.planService.approve(v.waiting.planStepId, 'ui'); v = await agent.resume('ui'); }
  assert.equal(v.state, 'done', v.sentence);
  assert.equal(v.logic.keptSentence, '11 of 11 logic units kept.');
  assert.equal(logic.records.length, 11, 'one loop record per checked step (10 steps, one checked twice)');
});
