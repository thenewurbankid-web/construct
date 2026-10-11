// Expressions in the plan (System 1 groundwork): cp1's default checks as expressions behave exactly as before; each
// line.* tool's pre (refuses before anything runs, in one sentence) and post (part of the checks); training records
// written through the Line-state path, readable, and holding no project name (typed slots only). Runs on copies of
// examples/line-sample with the real engine operations, plus stand-in planners where a case needs one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { assertPlanRecord, exprProblem } from '../packages/engine/line/contract.mjs';
import { evaluate } from '../packages/engine/line/expr.mjs';
import { runChange, DEFAULT_EXPECT, REAL_PLAN_OPS, createLinePlanRegistry, lineToolSpecs } from '../packages/engine/line/planTools.mjs';
import { createLinePlanService, loadPlanApi } from '../packages/engine/line/planService.mjs';
import { conditionsOf, checkPre, expectFor, CONDITION_TOOLS, DEFAULT_CHECK_EXPRS } from '../packages/engine/line/conditions.mjs';
import { buildFacts, summarizeFacts } from '../packages/engine/line/facts.mjs';
import { readPlanRecords, createSlotter, wordsOf } from '../packages/engine/line/records.mjs';
import { listFragments } from '../packages/engine/line/fragments.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/line-sample');
const BADGE = { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' };
const BADGE_FILE = 'features/orders/components/StatusBadge.tsx';
const copy = () => { const dir = makeTempDir('line-expr-plan-'); fs.cpSync(SAMPLE, dir, { recursive: true }); return dir; };
const MISSING_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };
const staticLoad = (o) => loadPlanApi({ ...o, linkOptions: MISSING_LINK });
const service = (dir, o = {}) => createLinePlanService({ root: dir, commands: null, trace: null, load: staticLoad, ...o });
const withoutExpr = (expect) => expect.map(({ expr: _e, ...c }) => c);
const facts = (dir) => buildFacts(dir);

test('default checks: cp1\'s two checks carry expressions, and every outcome and sentence is exactly as without them', () => {
  assert.deepEqual(DEFAULT_EXPECT.map((c) => [c.id, c.expr]), [['validate', DEFAULT_CHECK_EXPRS.validate], ['files', DEFAULT_CHECK_EXPRS.files]]);
  for (const c of DEFAULT_EXPECT) assert.equal(exprProblem(c.expr), null);
  const twoFiles = { ...REAL_PLAN_OPS, planBaseOn: () => ({ summary: 'Creates A and B.', files: [{ path: 'features/orders/components/A.tsx', content: '// @line-base components/Badge\nexport const A = 1;\n' }, { path: 'features/orders/components/B.tsx', content: '// @line-base components/Badge\nexport const B = 1;\n' }] }) };
  const crossFeature = { ...REAL_PLAN_OPS, planBaseOn: () => ({ summary: 'Creates C.', files: [{ path: 'features/billing/components/C.tsx', content: "// @line-base components/Badge\nimport { OrderButton } from '../../orders/components/OrderButton';\nexport const C = OrderButton;\n" }] }) };
  const cases = [
    ['a change that lands', BADGE, REAL_PLAN_OPS],
    ['a change the planner refuses', { ...BADGE, name: 'OrderButton' }, REAL_PLAN_OPS],
    ['a change validate refuses (new cross-feature import)', BADGE, crossFeature],
    ['a change already there', BADGE, twoFiles],
  ];
  for (const [what, req, ops] of cases) {
    const a = copy(); const b = copy();
    if (ops === twoFiles) for (const d of [a, b]) { runChange(d, 'line.baseOn', req, ops); }
    const withExprs = runChange(a, 'line.baseOn', { ...req, expect: DEFAULT_EXPECT }, ops);
    const legacy = runChange(b, 'line.baseOn', { ...req, expect: withoutExpr(DEFAULT_EXPECT) }, ops);
    assert.deepEqual(withExprs.checks, legacy.checks, what);
    assert.equal(withExprs.sentence, legacy.sentence, what);
  }
});

test('pre and post: the five tools declare both, as valid expressions; pre holds for a good request and refuses a bad one in one sentence', () => {
  assert.deepEqual([...CONDITION_TOOLS].sort(), ['line.baseOn', 'line.fix', 'line.promote', 'line.setFragment', 'line.setPageProp']);
  const dir = copy(); const f = facts(dir);
  const page = 'features/orders/pages/OrdersPage.tsx';
  const frag = listFragments(dir, page);
  const finding = summarizeFacts(f).findings.find((x) => x.fixIds.length);
  const good = {
    'line.baseOn': BADGE,
    'line.promote': { featureItemId: 'orders/components/OrderButton' },
    'line.setPageProp': { file: page, nodeId: 'n1', prop: 'title', kind: 'string', value: 'x' },
    'line.setFragment': { file: page, fragmentId: 'x', code: '', contentHash: frag.contentHash },
    'line.fix': { findingKey: finding.key, fixId: finding.fixIds[0] },
  };
  const bad = {
    'line.baseOn': [{ ...BADGE, name: 'OrderButton' }, /^This step cannot run as the project stands: in the items of feature orders, OrderButton has name "OrderButton", and nothing should\.$/],
    'line.promote': [{ featureItemId: 'orders/components/Nope' }, /nothing in the items of feature orders has id "orders\/components\/Nope"/],
    'line.setPageProp': [{ ...good['line.setPageProp'], file: 'features/orders/pages/Gone.tsx' }, /features\/orders\/pages\/Gone\.tsx does not exist yet/],
    'line.setFragment': [{ ...good['line.setFragment'], contentHash: 'stale' }, /the hash of features\/orders\/pages\/OrdersPage\.tsx is "[0-9a-f]{20}/],
    'line.fix': [{ findingKey: 'NOPE|x|1', fixId: 'y' }, /nothing in the findings has key "NOPE\|x\|1"/],
  };
  for (const tool of CONDITION_TOOLS) {
    const c = conditionsOf(tool, good[tool], { features: 'features' });
    assert.equal(exprProblem(c.pre), null, tool); assert.equal(exprProblem(c.post), null, tool);
    assert.equal(checkPre(f, tool, good[tool]), null, `${tool}: ${checkPre(f, tool, good[tool])}`);
    const [req, re] = bad[tool];
    const why = checkPre(f, tool, req);
    assert.match(String(why), re, tool);
    assert.match(why, /^[^\n]+\.$/, 'one sentence');
  }
  assert.equal(conditionsOf('line.createLayout', {}), null, 'a tool without conditions');
  // The spec describes `expr` on a check, from the code.
  assert.ok(lineToolSpecs().find((t) => t.name === 'line.baseOn').args.properties.expect.items.properties.expr);
});

test('post: after the step ran its post holds, and the step\'s files check carries it', () => {
  const dir = copy();
  const expect = expectFor('line.baseOn', BADGE, { features: 'features' }, DEFAULT_EXPECT);
  assert.deepEqual(expect.map((c) => c.id), ['validate', 'files'], 'still two checks');
  assert.deepEqual(expect[1].expr, { and: [DEFAULT_CHECK_EXPRS.files, conditionsOf('line.baseOn', BADGE).post] });
  const r = runChange(dir, 'line.baseOn', { ...BADGE, expect });
  assert.deepEqual(r.checks.map((c) => c.ok), [true, true], r.sentence);
  assert.equal(evaluate(facts(dir), conditionsOf('line.baseOn', BADGE).post).ok, true);
});

test('post as a check: a planner that writes the wrong thing passes cp1\'s file check but fails post, with post\'s sentence', () => {
  const dir = copy();
  const wrong = { ...REAL_PLAN_OPS, planBaseOn: () => ({ summary: 'Creates Other.', files: [{ path: 'features/orders/components/Other.tsx', content: '// @line-base components/Badge\nexport function Other() { return null; }\n' }] }) };
  const expect = expectFor('line.baseOn', BADGE, { features: 'features' }, DEFAULT_EXPECT);
  const r = runChange(dir, 'line.baseOn', { ...BADGE, expect }, wrong);
  assert.equal(r.apply.ok, true, 'the writer landed it');
  assert.deepEqual(r.checks.map((c) => [c.checkId, c.ok]), [['validate', true], ['files', false]]);
  assert.equal(r.checks[1].sentence, 'Nothing in the items of feature orders has name "StatusBadge" and base "components/Badge".');
  assert.match(r.sentence, /^This needs you: 1 of 2 checks passed\. Nothing in the items of feature orders has name "StatusBadge"/);
  const legacy = runChange(copy(), 'line.baseOn', { ...BADGE, expect: withoutExpr(DEFAULT_EXPECT) }, wrong);
  assert.deepEqual(legacy.checks.map((c) => c.ok), [true, true], 'without post the wrong file would have passed');
});

test('pre refusal: a step whose pre fails is refused in one sentence before it joins the plan, and at run time nothing is written', async () => {
  const dir = copy();
  const lenient = { ...REAL_PLAN_OPS, planBaseOn: (_r, req) => ({ summary: `Creates ${req.name}.`, files: [{ path: `features/${req.feature}/components/${req.name}.tsx`, content: `// @line-base ${req.libraryId}\nexport function ${req.name}() { return null; }\n` }] }) };
  const svc = service(dir, { ops: lenient, records: null });
  const refused = await svc.addStep({ tool: 'line.baseOn', args: { ...BADGE, name: 'OrderButton' } }, 'ui');
  assert.deepEqual([refused.ok, refused.code], [false, 'PRE_FAILED']);
  assert.equal(refused.sentence, 'This step cannot run as the project stands: in the items of feature orders, OrderButton has name "OrderButton", and nothing should.');
  assert.deepEqual((await svc.view()).steps, [], 'nothing joined the plan');
  // Joins while the pre holds; the project changes; at run time the pre refuses and nothing is written.
  const a = await svc.addStep({ tool: 'line.baseOn', args: BADGE }, 'ui');
  assert.equal(a.ok, true, a.sentence);
  fs.rmSync(path.join(dir, 'library/components/Badge.tsx'));
  await svc.approve(a.stepId, 'ui');
  const ran = await svc.runNext('ui');
  const step = ran.steps[0];
  assert.equal(step.state, 'needs-you');
  assert.equal(step.result.apply.sentence, 'Nothing was saved: this step cannot run as the project stands: library item components/Badge does not exist yet.');
  assert.equal(fs.existsSync(path.join(dir, BADGE_FILE)), false);
  // The registry itself refuses the same way (the plan runner's only path).
  const reg = createLinePlanRegistry({ root: dir, ops: lenient });
  const direct = await reg.call('line.baseOn', BADGE);
  assert.match(direct.apply.sentence, /library item components\/Badge does not exist yet/);
});

/** Every name the project's facts hold (features, items, library items, files), plus each word of those names. */
function projectNames(...dirs) {
  const names = new Set();
  for (const d of dirs) {
    const s = summarizeFacts(buildFacts(d));
    for (const [f, feat] of Object.entries(s.features)) { names.add(f); for (const i of feat.items) { names.add(i.name); names.add(i.id); names.add(i.file); } }
    for (const [id, l] of Object.entries(s.library)) { names.add(id); names.add(l.name); names.add(l.file); }
    for (const p of Object.keys(s.files)) names.add(p);
  }
  return names;
}
const leaks = (text, names) => [...names].filter((n) => new RegExp(`(?<![A-Za-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i').test(text));

test('records: each finished step appends one readable record (structure before and after, delta, steps, checks with exprs, pre, approval)', async () => {
  const dir = copy();
  const svc = service(dir);
  const a = await svc.addStep({ tool: 'line.baseOn', args: BADGE }, 'ui');
  await svc.approve(a.stepId, 'ui');
  await svc.runNext('ui');
  const b = await svc.addStep({ tool: 'line.promote', args: { featureItemId: 'orders/components/StatusBadge' } }, 'ui');
  assert.equal(b.ok, true, b.sentence);
  await svc.approve(b.stepId, 'ui');
  await svc.runNext('ui');
  assert.equal(svc.records.problem, null);
  const { records, skipped, file } = readPlanRecords(dir);
  assert.equal(file, 'line/records/plans.jsonl');
  assert.equal(skipped, 0);
  assert.equal(records.length, 2);
  records.forEach((r) => assertPlanRecord(r));
  const [first, second] = records;
  assert.deepEqual(first.steps.map((s) => s.tool), ['line.baseOn']);
  assert.deepEqual(second.steps.map((s) => s.tool), ['line.baseOn', 'line.promote']);
  assert.equal(second.step, 2);
  assert.deepEqual([first.approved, first.repaired, first.passed, first.pre.ok], [true, false, 2, true]);
  assert.deepEqual(first.checks.map((c) => [c.id, c.ok]), [['validate', true], ['files', true]]);
  assert.ok(first.checks.every((c) => c.expr && exprProblem(c.expr) === null), 'each check keeps its expression');
  assert.notEqual(first.before.project, first.after.project, 'a step is a transition between structure states');
  assert.equal(first.after.project, second.before.project);
  assert.equal(first.delta.added.length, 1);
  assert.match(first.delta.added[0], /^<feature:F\d+>\/components\/<item:I\d+ kind=components> base=<lib:L\d+ kind=components>$/);
  assert.ok(second.delta.removed.length === 1 && second.delta.added.some((l) => l.startsWith('library/components/<lib:')));
  assert.deepEqual(first.steps[0].args, { libraryId: first.steps[0].args.libraryId, feature: first.steps[0].args.feature, name: first.steps[0].args.name });
  assert.match(first.steps[0].args.name, /^<(name|item):[NI]\d+/);
});

test('records hold logic only: no identifier from the project\'s facts (or a word of one) appears in the training JSONL', async () => {
  const dir = copy();
  const before = makeTempDir('line-expr-before-'); fs.cpSync(dir, before, { recursive: true });
  const svc = service(dir);
  // A goal written with the project's own words, so the intent has names to strip.
  const a = await svc.addStep({ tool: 'line.baseOn', args: BADGE, why: 'Add a status badge to the orders list.' }, 'ui');
  await svc.approve(a.stepId, 'ui');
  await svc.runNext('ui');
  const page = 'features/orders/pages/OrdersPage.tsx';
  const frag = listFragments(dir, page);
  const s = await svc.addStep({ tool: 'line.setFragment', args: { file: page, fragmentId: frag.fragments[0].id, code: frag.fragments[0].code.replace('more', 'all'), contentHash: frag.contentHash } }, 'ui');
  assert.equal(s.ok, true, s.sentence);
  await svc.approve(s.stepId, 'ui');
  await svc.runNext('ui');
  const raw = fs.readFileSync(path.join(dir, 'line/records/plans.jsonl'), 'utf8');
  assert.equal(raw.trim().split('\n').length, 2);
  const names = projectNames(before, dir);
  names.add(BADGE.name);
  const words = new Set([...names].flatMap((n) => (n.includes('/') ? [] : wordsOf(n))));
  assert.deepEqual(leaks(raw, names), [], 'no project name');
  assert.deepEqual(leaks(raw, words), [], 'no word of a project name');
  assert.ok(!raw.includes(frag.contentHash) && !raw.includes(frag.fragments[0].code.slice(0, 20)), 'no code and no content hash');
  // The live plan keeps the real names.
  assert.ok((await svc.view()).steps[0].args.name === 'StatusBadge');
});

test('slots: the same name gets the same slot in a record; an intent loses each word of a project name', () => {
  const project = { library: [{ id: 'components/Badge', kind: 'components', name: 'Badge', file: 'library/components/Badge.tsx' }], features: [{ name: 'orders', items: [{ id: 'orders/components/OrderRow', kind: 'components', name: 'OrderRow', file: 'features/orders/components/OrderRow.tsx' }] }] };
  const sl = createSlotter(project);
  sl.learnArgs({ name: 'StatusBadge' });
  assert.equal(sl.text('features/orders/components/OrderRow.tsx'), 'features/<feature:F1>/components/<item:I1 kind=components>.tsx');
  assert.equal(sl.args({ featureItemId: 'orders/components/OrderRow' }).featureItemId, '<item:I1 kind=components>', 'an item id and its name share a slot');
  assert.equal(sl.text('Put a status badge on each order row.', { free: true }), 'Put a <word:W1> <word:W2> on each <word:W3> <word:W4>.');
  assert.deepEqual(sl.expr({ eq: [{ path: ['library', 'components/Badge', 'kind'] }, 'components'] }), { eq: [{ path: ['library', '<lib:L1 kind=components>', 'kind'] }, 'components'] });
});

test('CLI: construct line check prints each failed part as a sentence (exit 1) or "Holds."; line records reads the records', async () => {
  const { spawnSync } = await import('node:child_process');
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/cli/construct.mjs');
  const run = (...args) => spawnSync(process.execPath, [cli, 'line', ...args], { encoding: 'utf8' });
  const miss = run('check', '--dir', SAMPLE, JSON.stringify({ exists: { path: ['files', BADGE_FILE] } }));
  assert.equal(miss.status, 1);
  assert.equal(miss.stdout.trim(), `${BADGE_FILE} does not exist yet.`);
  const holds = run('check', '--dir', SAMPLE, JSON.stringify({ exists: { path: ['library', 'components/Badge'] } }));
  assert.deepEqual([holds.status, holds.stdout.trim()], [0, 'Holds.']);
  const bad = run('check', '--dir', SAMPLE, '{"foo": 1}');
  assert.match(bad.stdout, /^This expression cannot be checked: "foo" is not an operator/);
  const dir = copy();
  const svc = service(dir);
  const a = await svc.addStep({ tool: 'line.baseOn', args: BADGE }, 'ui');
  await svc.approve(a.stepId, 'ui'); await svc.runNext('ui');
  const recs = run('records', '--dir', dir);
  assert.match(recs.stdout, /^1 plan record in line\/records\/plans\.jsonl: 1 passed every check, 0 repaired an earlier step\./);
  assert.ok(!recs.stdout.includes('StatusBadge'));
});
