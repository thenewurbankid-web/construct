// Line Cockpit contract (packages/engine/line/contract.mjs) over its mock (mock.mjs). These cases are the
// behaviour every real implementation (T1 model, T2 ops, T3 page prop, T4 server) must also show; their own
// tests reuse the assert* shape checks on real projects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLineProject, assertStagedChange, assertApplyResult, assertFinding, assertFragmentList, LineOpError, LINE_API } from '../packages/engine/line/contract.mjs';
import { createMockLineOps, MOCK_FILES } from '../packages/engine/line/mock.mjs';
import { createMockImport } from '../packages/engine/line/mockImport.mjs';
import { assertImportScan, assertImportPlan, assertImportApplyResult, IMPORT_TOOLS } from '../packages/engine/line/contract.mjs';

const ROOT = '/mock';

test('contract: the project view has the library, the features, base links and findings', () => {
  const ops = createMockLineOps();
  const p = ops.readLineProject(ROOT);
  assertLineProject(p);
  assert.deepEqual(p.library.map((l) => `${l.id}:${l.level ?? '-'}`), ['components/Button:atom', 'components/Dialog:molecule', 'components/TextField:atom', 'pages/ListPage:-']);
  assert.deepEqual(p.library.find((l) => l.id === 'components/Button').usedBy, [{ feature: 'orders', file: 'features/orders/components/OrderButton.tsx' }]);
  const invoices = p.features.find((f) => f.name === 'billing').items[0];
  assert.equal(invoices.base.libraryId, 'pages/ListPage');
  assert.equal(invoices.status, 'problem');
  assert.equal(invoices.findings[0].rule, 'LINE-DIR');
});

test('contract: base-on plans one new feature file with its base link, and applying it lands it', () => {
  const ops = createMockLineOps();
  const change = ops.planBaseOn(ROOT, { libraryId: 'components/TextField', feature: 'billing', name: 'AmountField' });
  assertStagedChange(change);
  assert.equal(change.files[0].path, 'features/billing/components/AmountField.tsx');
  assert.match(change.files[0].content, /^\/\/ @line-base components\/TextField\n/);
  assert.equal(ops.files()['features/billing/components/AmountField.tsx'], undefined, 'planning writes nothing');
  const r = ops.applyChange(ROOT, change);
  assertApplyResult(r);
  assert.equal(r.ok, true);
  assert.equal(ops.readLineProject(ROOT).library.find((l) => l.id === 'components/TextField').usedBy.length, 1);
});

test('contract: refusals are one sentence and change nothing', () => {
  const ops = createMockLineOps();
  assert.throws(() => ops.planBaseOn(ROOT, { libraryId: 'components/Nope', feature: 'orders', name: 'X' }), (e) => e instanceof LineOpError && e.code === 'UNKNOWN_ITEM');
  assert.throws(() => ops.planBaseOn(ROOT, { libraryId: 'components/Button', feature: 'orders', name: 'OrderButton' }), (e) => e instanceof LineOpError && e.code === 'NAME_TAKEN');
  const before = ops.files();
  const bad = { summary: 'Adds a cross-feature import.', files: [{ path: 'features/billing/components/Cross.tsx', content: "// @line-base components/Button\nimport { OrderButton } from '../../orders/components/OrderButton';\n" }] };
  const r = ops.applyChange(ROOT, bad);
  assertApplyResult(r);
  assert.equal(r.ok, false);
  assert.equal(r.findings[0].rule, 'LINE-DIR');
  assert.match(r.sentence, /^Nothing was saved: /);
  assert.deepEqual(ops.files(), before);
});

test('contract: promote moves a feature item into the library and fixes its users, so the cross-feature finding goes away', () => {
  const ops = createMockLineOps();
  const change = ops.planPromote(ROOT, { featureItemId: 'orders/components/OrderButton' });
  assertStagedChange(change);
  assert.deepEqual(change.files.map((f) => `${f.path}:${f.content === null ? 'delete' : 'write'}`).sort(), [
    'features/billing/pages/InvoicesPage.tsx:write', 'features/orders/components/OrderButton.tsx:delete', 'library/components/OrderButton.tsx:write',
  ]);
  const r = ops.applyChange(ROOT, change);
  assert.equal(r.ok, true, r.sentence);
  const p = ops.readLineProject(ROOT);
  assert.ok(p.library.some((l) => l.id === 'components/OrderButton'));
  assert.deepEqual(p.findings, []);
});

test('contract: set-prop plans one edited page and lands it', () => {
  const ops = createMockLineOps();
  const change = ops.planSetProp(ROOT, { file: 'features/orders/pages/OrdersPage.tsx', nodeId: 'n1', prop: 'title', kind: 'string', value: 'All orders' });
  assertStagedChange(change);
  assert.equal(ops.applyChange(ROOT, change).ok, true);
  assert.match(ops.files()['features/orders/pages/OrdersPage.tsx'], /title="All orders"/);
});

test('contract: the shape checks reject what Cockpit must never show', () => {
  assert.throws(() => assertFinding({ sentence: 'no full stop', rule: 'X', severity: 'error', file: 'a', line: 1 }), /full sentence/);
  assert.throws(() => assertStagedChange({ summary: 'Escapes.', files: [{ path: '../x', content: '' }] }), /inside the project/);
  assert.throws(() => assertApplyResult({ ok: false, sentence: 'Refused.', files: ['a'], findings: [] }), /wrote nothing/);
  assert.deepEqual(LINE_API.map((r) => `${r.method} ${r.path}`), ['GET /api/line/project', 'GET /api/line/page-tree', 'POST /api/line/base-on', 'POST /api/line/promote', 'POST /api/line/page-prop', 'GET /api/line/render', 'POST /api/line/fix', 'GET /api/line/fragments', 'POST /api/line/fragment', 'GET /api/line/import/folders', 'POST /api/line/import/scan', 'POST /api/line/import/plan', 'POST /api/line/import/apply']);
});

test('contract: every mock finding carries a typed fix, and applying the top one by key clears it', () => {
  const ops = createMockLineOps({ files: { ...MOCK_FILES, 'features/billing/components/Total.tsx': "import { Button } from '../../../library/components/Button';\nexport function Total() { return <Button label=\"Total\" />; }\n" } });
  const { findings } = ops.readLineProject(ROOT);
  findings.forEach((f, i) => assertFinding(f, `findings[${i}]`));
  assert.deepEqual(findings.map((f) => `${f.rule}:${f.fixes[0].id}`).sort(), ['LINE-BASE:LINE-BASE/set-base:components/Button', 'LINE-DIR:LINE-DIR/promote']);
  for (const f of findings) {
    const r = ops.applyFix(ROOT, { findingKey: f.key, fixId: f.fixes[0].id });
    assertApplyResult(r);
    assert.equal(r.ok, true, r.sentence);
  }
  assert.deepEqual(ops.readLineProject(ROOT).findings, []);
  assert.throws(() => ops.applyFix(ROOT, { findingKey: 'LINE-DIR|x|1', fixId: 'LINE-DIR/promote' }), (e) => e instanceof LineOpError && e.code === 'UNKNOWN_FINDING');
  const bad = (fixes) => ({ sentence: 'Bad.', rule: 'X', severity: 'error', file: 'a', line: 1, fixes });
  assert.throws(() => assertFinding(bad([{ id: 'a', sentence: 'Fix.', rank: 1, step: { tool: 'fs.write', args: {} } }])), /step.tool/);
  assert.throws(() => assertFinding(bad([{ id: 'a', sentence: 'Fix.', rank: 2, step: null }, { id: 'b', sentence: 'Fix.', rank: 1, step: null }])), /sorted by rank/);
});

test('contract: fragments list the code a person can edit in place, and a fragment edit changes only its range', () => {
  const ops = createMockLineOps();
  const file = 'features/orders/pages/OrdersPage.tsx';
  const list = ops.listFragments(ROOT, file);
  assertFragmentList(list);
  const frag = list.fragments.find((f) => f.kind === 'handler');
  assert.ok(frag, 'the onMore handler is a fragment');
  assert.equal(frag.label, 'What happens when ListPage asks for more');
  const before = ops.files()[file];
  const code = "() => alert('All orders')";
  const change = ops.planSetFragment(ROOT, { file, fragmentId: frag.id, code, contentHash: list.contentHash });
  assertStagedChange(change);
  const after = change.files[0].content;
  assert.equal(after.slice(0, frag.range.start), before.slice(0, frag.range.start));
  assert.equal(after.slice(frag.range.start + code.length), before.slice(frag.range.end));
  assert.equal(ops.applyChange(ROOT, change).ok, true);
  assert.throws(() => ops.planSetFragment(ROOT, { file, fragmentId: frag.id, code: '() => 1', contentHash: list.contentHash }), (e) => e instanceof LineOpError && e.code === 'STALE');
  const fresh = ops.listFragments(ROOT, file);
  assert.throws(() => ops.planSetFragment(ROOT, { file, fragmentId: frag.id, code: '() => alert(', contentHash: fresh.contentHash }), (e) => e.code === 'BAD_CODE' && /\.$/.test(e.sentence) && typeof e.detail === 'string');
  assert.throws(() => assertFragmentList({ ...fresh, fragments: [{ ...fresh.fragments[0], label: 'A sentence.' }] }), /label/);
});

test('contract: import scan proposes in plain English and asks only where two rules disagree; the plan follows the answer', () => {
  const imp = createMockImport();
  const scan = imp.scan({ folder: 'src/alerts' });
  assertImportScan(scan);
  assert.deepEqual(scan.questions.map((q) => q.id), ['generic-name:src/alerts/components/Table.tsx']);
  assert.deepEqual(scan.found.filter((f) => f.confidence === 'ask').map((f) => f.name), ['Table']);
  const plan = imp.plan({ folder: 'src/alerts', answers: {} });
  assertImportPlan(plan);
  assert.ok(plan.steps.every((s) => IMPORT_TOOLS.includes(s.tool)));
  const asFeature = imp.plan({ folder: 'src/alerts', answers: { 'generic-name:src/alerts/components/Table.tsx': 'feature:alerts' } });
  assertImportPlan(asFeature);
  assert.ok(asFeature.steps.some((s) => s.id.endsWith('feature-Table')) && !plan.steps.some((s) => s.id.endsWith('feature-Table')));
  const r = imp.apply({ folder: 'src/alerts', answers: {} });
  assertImportApplyResult(r);
  assert.equal(r.ok, true);
  assert.throws(() => imp.scan({ folder: '../elsewhere' }), (e) => e instanceof LineOpError && e.code === 'BAD_FOLDER');
  assert.throws(() => assertImportScan({ ...scan, found: [{ ...scan.found[0], file: 'src/App.tsx' }] }), /inside the folder/);
  assert.throws(() => assertImportPlan({ ...plan, steps: [{ ...plan.steps[0], tool: 'fs.writeFile' }] }), /must be one of/);
});
