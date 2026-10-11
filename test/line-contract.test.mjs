// Line Cockpit contract (packages/engine/line/contract.mjs) over its mock (mock.mjs). These cases are the
// behaviour every real implementation (T1 model, T2 ops, T3 page prop, T4 server) must also show; their own
// tests reuse the assert* shape checks on real projects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLineProject, assertStagedChange, assertApplyResult, assertFinding, LineOpError, LINE_API } from '../packages/engine/line/contract.mjs';
import { createMockLineOps } from '../packages/engine/line/mock.mjs';

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
  assert.deepEqual(LINE_API.map((r) => `${r.method} ${r.path}`), ['GET /api/line/project', 'GET /api/line/page-tree', 'POST /api/line/base-on', 'POST /api/line/promote', 'POST /api/line/page-prop', 'GET /api/line/render', 'GET /api/line/plan', 'POST /api/line/plan/step', 'POST /api/line/plan/approve', 'POST /api/line/plan/run']);
});
