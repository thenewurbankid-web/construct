// Line feature detail (packages/engine/line/feature.mjs readLineFeature, GET /api/line/feature) on a copy of
// examples/line-sample: items by kind, the static Auto summary, the spec's stories with static coverage, findings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { assertLineFeatureDetail, LineOpError } from '../packages/engine/line/contract.mjs';
import { readLineFeature } from '../packages/engine/line/feature.mjs';
import { parseSpec, coverSpec, testTitles, summarySentences } from '../packages/engine/line/featureText.mjs';

const SAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples/line-sample');
function copy() {
  const dir = makeTempDir('construct-line-feature-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}
const names = (d) => Object.fromEntries(Object.entries(d.items).map(([k, v]) => [k, v.map((i) => i.name)]));

test('feature: orders lists its items by kind, a static summary of their bases, and its spec with one point covered', () => {
  const d = readLineFeature(copy(), 'orders');
  assertLineFeatureDetail(d);
  assert.deepEqual(names(d), { components: ['OrderButton', 'OrderCard'], pages: ['OrdersPage'], workflows: ['orderCheckout'], fixtures: [] });
  assert.deepEqual(d.summary, { via: 'static', sentences: [
    'orders has 1 page, 2 components and 1 workflow.', 'OrdersPage is based on ListPage.', 'OrderButton is based on Button.',
    'OrderCard is based on Card.', 'orderCheckout is based on checkout.', 'Everything in orders passes the checks.',
  ] });
  assert.equal(d.spec.file, 'features/orders/spec.md');
  assert.equal(d.spec.stories.length, 1);
  assert.match(d.spec.stories[0].text, /^As a shopper, I want/);
  assert.deepEqual(d.spec.stories[0].points.map((p) => [p.id, p.covered, p.by]), [['s1.p1', true, ['OrdersPage']], ['s1.p2', false, []]]);
  assert.deepEqual(d.findings, []);
});

test('feature: billing shows its two planted problems on the items and in the summary', () => {
  const d = readLineFeature(copy(), 'billing');
  assertLineFeatureDetail(d);
  assert.deepEqual(d.findings.map((f) => `${f.rule} ${f.file}:${f.line}`).sort(), ['LINE-BASE features/billing/components/InvoiceCard.tsx:1', 'LINE-DIR features/billing/pages/InvoicesPage.tsx:4']);
  assert.equal(d.items.pages[0].status, 'problem');
  assert.ok(d.summary.sentences.includes('InvoicesPage uses OrderButton from feature orders, which a feature may not do.'));
  assert.ok(d.summary.sentences.includes('InvoiceCard has no library base yet.'));
  assert.ok(d.summary.sentences.includes('InvoiceCard also uses Card from the library.'));
  assert.equal(d.summary.sentences.at(-1), '2 items need attention.');
  assert.deepEqual(d.spec.stories.map((s) => [s.text, s.points.length]), [['Billing', 1]]);
});

test('feature: a test title in the feature covers the point that names it; no spec.md gives spec null', () => {
  const dir = copy();
  fs.writeFileSync(path.join(dir, 'features/orders/components/OrderButton.test.tsx'), "test('a shopper can cancel an order before it ships', () => {});\n");
  const d = readLineFeature(dir, 'orders');
  assert.deepEqual(d.spec.stories[0].points[1].by, ['test "a shopper can cancel an order before it ships"']);
  fs.rmSync(path.join(dir, 'features/billing/spec.md'));
  assert.equal(readLineFeature(dir, 'billing').spec, null);
});

test('feature: an unknown feature and a non-Line project are refused with one sentence', () => {
  assert.throws(() => readLineFeature(copy(), 'nope'), (e) => e instanceof LineOpError && e.code === 'UNKNOWN_ITEM' && e.sentence === 'There is no feature "nope"; pick one from the list.');
  const dir = copy();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\n');
  assert.throws(() => readLineFeature(dir, 'orders'), (e) => e instanceof LineOpError && e.code === 'NOT_LINE');
});

test('featureText: spec parsing, coverage and test titles are plain static rules', () => {
  const stories = parseSpec('# T\n\n- loose point\n\n## Story: One\n\n* [x] Uses OrderCard\n1. Nothing\n```\n- not a point\n```\n');
  assert.deepEqual(stories.map((s) => [s.id, s.text, s.points.map((p) => `${p.id} ${p.text}`)]), [
    ['s1', 'T', ['s1.p1 loose point']], ['s2', 'One', ['s2.p1 Uses OrderCard', 's2.p2 Nothing']],
  ]);
  const covered = coverSpec(stories, { itemNames: ['OrderCard', 'Order'], testTitles: [] });
  assert.deepEqual(covered[1].points[0].by, ['OrderCard'], 'whole words only: Order does not match inside OrderCard');
  assert.deepEqual(testTitles("it('a', () => {}); test.skip(\"b\", f); describe('c', f);"), ['a', 'b']);
  assert.deepEqual(summarySentences('empty', [], new Map(), new Map()), ['empty has nothing in it yet.']);
});
