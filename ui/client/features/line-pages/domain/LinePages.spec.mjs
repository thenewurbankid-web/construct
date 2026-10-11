import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockLineOps, MOCK_FILES } from '../../../../../packages/engine/line/mock.mjs';
import { assertApplyResult } from '../../../../../packages/engine/line/contract.mjs';
import { baseText, featurePages, findPage } from './PageRows.ts';
import { featureNames, featureSummary } from './FeatureList.ts';
import { coerceValue, pageParts } from './PageParts.ts';
import { saveOutcome, setPropRequest } from './SaveOutcome.ts';
import { treeFromSource } from './SourceTree.ts';

const project = () => createMockLineOps().readLineProject('/mock');

test('featurePages: a feature lists only its pages, each with its library base and status', () => {
  const p = project();
  assert.deepEqual(featureNames(p), ['billing', 'orders']);
  const orders = featurePages(p, 'orders');
  assert.deepEqual(orders.map((r) => r.name), ['OrdersPage']);
  assert.deepEqual(orders[0].base, { ok: true, text: 'Based on ListPage' });
  assert.equal(orders[0].status, 'ok');
  assert.deepEqual(featurePages(p, 'nope'), []);
});

test('featurePages: the planted cross-feature import shows as a problem with its sentence and rule', () => {
  const [invoices] = featurePages(project(), 'billing');
  assert.equal(invoices.status, 'problem');
  assert.equal(invoices.findings[0].rule, 'LINE-DIR');
  assert.match(invoices.findings[0].sentence, /^Feature "billing" imports from feature "orders"/);
});

test('featureSummary: says how many pages and how many need attention, in words', () => {
  const p = project();
  assert.equal(featureSummary(p, 'orders'), 'One page, all fine.');
  assert.equal(featureSummary(p, 'billing'), 'One page, one needs attention.');
  assert.equal(featureSummary(p, 'nope'), 'No pages yet.');
});

test('baseText: a missing or broken base becomes a plain-English problem', () => {
  const p = project();
  const item = { ...findPage(p, 'orders/pages/OrdersPage') };
  assert.deepEqual(baseText(p, { ...item, base: { value: null, libraryId: null } }), { ok: false, text: 'It has no library base yet, so pick the library page it is based on.' });
  assert.match(baseText(p, { ...item, base: { value: 'pages/Gone', libraryId: null } }).text, /"pages\/Gone" is not in the library/);
  assert.equal(findPage(p, 'orders/components/OrderButton'), null, 'only pages are pages');
});

test('treeFromSource + pageParts: the mock page reads as the server tree shape, editable props only', () => {
  const tree = treeFromSource(MOCK_FILES['features/orders/pages/OrdersPage.tsx'], 'features/orders/pages/OrdersPage.tsx', 'orders');
  assert.equal(tree.roots[0].id, 'n0');
  assert.equal(tree.roots[0].tag, 'ListPage');
  assert.deepEqual(pageParts(tree), [{ nodeId: 'n0', tag: 'ListPage', depth: 0, props: [{ name: 'title', kind: 'string', value: 'Orders' }] }]);
  const nested = treeFromSource('export default function P() { return <><main><Card title="A" count={3} open onPick={pick} {...rest} /></main></>; }');
  const parts = pageParts(nested);
  assert.deepEqual(parts.map((x) => [x.nodeId, x.tag, x.depth]), [['n1', 'main', 0], ['n2', 'Card', 1]], 'the fragment is not a part');
  assert.deepEqual(parts[1].props.map((x) => [x.name, x.kind, x.value]), [['title', 'string', 'A'], ['count', 'number', 3], ['open', 'boolean', true]]);
});

test('coerceValue: an input string becomes the prop kind, and a bad number is refused', () => {
  assert.equal(coerceValue('number', '42'), 42);
  assert.equal(coerceValue('number', 'abc'), null);
  assert.equal(coerceValue('number', ''), null);
  assert.equal(coerceValue('boolean', false), false);
  assert.equal(coerceValue('string', 'Orders 2'), 'Orders 2');
});

test('save round trip on the contract mock: a title saves, even on a page with an old problem; a new cross-feature import is refused', () => {
  const ops = createMockLineOps();
  const tree = treeFromSource(ops.files()['features/orders/pages/OrdersPage.tsx']);
  const [part] = pageParts(tree);
  const ok = ops.applyChange('/m', ops.planSetProp('/m', setPropRequest('features/orders/pages/OrdersPage.tsx', part, part.props[0], 'All orders')));
  assertApplyResult(ok);
  assert.deepEqual(saveOutcome(ok), { ok: true, sentence: 'Saved. Sets title to "All orders" on the page OrdersPage.', findings: [] });
  // InvoicesPage already imports from orders (LINE-DIR); only NEW problems block, so a title edit lands.
  const invoices = ops.applyChange('/m', ops.planSetProp('/m', { file: 'features/billing/pages/InvoicesPage.tsx', nodeId: 'n0', prop: 'title', kind: 'string', value: 'Bills' }));
  assert.equal(saveOutcome(invoices).ok, true);
  // A change that adds a cross-feature import to OrdersPage is refused and leaves it as it was.
  const file = 'features/orders/pages/OrdersPage.tsx';
  const before = ops.files()[file];
  const content = before.replace("import ListPage", "import { InvoicesPage } from '../../billing/pages/InvoicesPage';\nimport ListPage");
  const refused = ops.applyChange('/m', { summary: 'Adds an import.', files: [{ path: file, content }] });
  const out = saveOutcome(refused);
  assert.equal(out.ok, false);
  assert.match(out.sentence, /^Nothing was saved: feature "orders" imports from feature "billing"/);
  assert.equal(out.findings[0].rule, 'LINE-DIR');
  assert.equal(ops.files()[file], before);
});

test('saveOutcome: a LineOpError refusal and a silent server both read "Nothing was saved: ..."', () => {
  assert.equal(saveOutcome({ ok: false, sentence: 'This part has no label to change.', code: 'UNKNOWN_PROP' }).sentence, 'Nothing was saved: this part has no label to change.');
  assert.equal(saveOutcome(null).sentence, 'Nothing was saved: the server did not answer, so try again.');
  assert.equal(saveOutcome({}).ok, false);
});
