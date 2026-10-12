// Line graph (G1) on examples/line-sample and a small alias fixture. Expected numbers were written before the builder
// ran (by hand from the sample's sources); the unit count is the logic map's, pinned once observed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildLineGraph, updateLineGraph, readLineGraph, graphFiles, graphSentence } from '../packages/engine/line/graph/build.mjs';
import { queryGraph } from '../packages/engine/line/graph/query.mjs';
import { assertLineGraph } from '../packages/engine/line/graph/contract.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(REPO, 'examples/line-sample');
const ALIAS = path.join(REPO, 'test/fixtures/line-graph-alias');

const copy = (src) => {
  const dir = makeTempDir('line-graph-');
  fs.cpSync(src, dir, { recursive: true });
  return dir;
};
const has = (g, from, type, to) => g.edges.some((e) => e.from === from && e.type === type && e.to === to);
const countOf = (g, type) => g.edges.filter((e) => e.type === type).length;
const strip = (g) => ({ nodes: g.nodes, edges: g.edges, counts: g.index.counts, files: g.index.files });

const ORDERS_PAGE = 'item:orders/pages/OrdersPage';
const LIST_PAGE = 'item:library/pages/ListPage';

test('the sample graph has the expected nodes and edges, and passes the contract', () => {
  const root = copy(SAMPLE);
  const { graph: g, stats } = buildLineGraph(root);
  assertLineGraph(g);
  assert.equal(stats.full, true);
  const c = g.index.counts;
  // Written by hand from the sample: 11 library + 6 feature items, the library, 2 features, 2 routes, 2 findings,
  // 3 spec points (orders 2, billing 1), no plan steps.
  assert.deepEqual({ ...c.byKind, unit: undefined }, { item: 17, library: 1, feature: 2, route: 2, finding: 2, specPoint: 3, unit: undefined });
  // Units are the logic map's (pinned once observed): 35 fingerprints, 38 placements. One fingerprint is shared by
  // four items (the four library workflows' identical `export const roles`): one unit node, PART_OF each of them.
  const units = c.byKind.unit ?? 0;
  assert.equal(units, 35);
  const unitPlacements = g.edges.filter((e) => e.type === 'PART_OF' && e.from.startsWith('unit:')).length;
  assert.equal(unitPlacements, 38);
  assert.equal(c.nodes, 27 + units);
  assert.deepEqual(c.byType, {
    BASED_ON: 5, CALLS: 1, COVERS: 1, FLAGS: 2, HANDLES_EVENT: 1, IMPORTS: 11, IN_FEATURE: 6, IN_LIBRARY: 11,
    PART_OF: 2 + unitPlacements, RENDERS: 10,
  });
  assert.equal(c.edges, 50 + unitPlacements);
  assert.equal(c.byLayer.domain, undefined, 'the domain layer is a stub in G1');
  assert.equal(c.byLayer.runtime, undefined, 'the runtime layer is G2');
  assert.match(graphSentence(g, stats), /^The Line graph has \d+ nodes \(17 items, \d+ logic units\) and \d+ edges: .*\.$/);
});

test('#856 an export unit is labelled by the name it exports, not "export in <module>"', () => {
  const { graph: g } = buildLineGraph(copy(SAMPLE));
  const exportLabels = g.nodes.filter((n) => n.kind === 'unit' && n.attrs?.unitKind === 'export').map((n) => n.label);
  assert.ok(exportLabels.length > 0);
  assert.ok(exportLabels.every((l) => !/ in /.test(l)), exportLabels.join(' | '));
  assert.ok(exportLabels.includes('export roles'), exportLabels.join(' | '));
  // A unit inside a function keeps "kind in fn".
  assert.ok(g.nodes.some((n) => n.kind === 'unit' && n.attrs?.unitKind !== 'export' && / in /.test(n.label)));
});

test('the sample graph has the planted and the expected edges', () => {
  const { graph: g } = buildLineGraph(copy(SAMPLE));
  assert.ok(has(g, ORDERS_PAGE, 'BASED_ON', LIST_PAGE), 'OrdersPage BASED_ON ListPage');
  assert.ok(has(g, 'item:billing/pages/InvoicesPage', 'IMPORTS', 'item:orders/components/OrderButton'), 'the planted cross-feature import');
  assert.ok(has(g, ORDERS_PAGE, 'HANDLES_EVENT', LIST_PAGE), 'OrdersPage handles ListPage\'s onMore');
  assert.ok(has(g, 'item:library/components/Card', 'RENDERS', 'item:library/components/Button'), 'Card renders Button');
  assert.ok(has(g, 'item:orders/workflows/orderCheckout', 'CALLS', 'item:library/workflows/checkout'), 'orderCheckout calls checkout');
  assert.ok(has(g, ORDERS_PAGE, 'IN_FEATURE', 'feature:orders'));
  assert.ok(has(g, LIST_PAGE, 'IN_LIBRARY', 'library'));
  assert.ok(has(g, ORDERS_PAGE, 'PART_OF', 'route:/orders'));
  assert.ok(has(g, 'spec:orders#1', 'COVERS', ORDERS_PAGE));
  assert.ok(has(g, 'finding:LINE-DIR|features/billing/pages/InvoicesPage.tsx|4', 'FLAGS', 'item:billing/pages/InvoicesPage'));
  const e = g.edges.find((x) => x.from === ORDERS_PAGE && x.type === 'BASED_ON');
  assert.deepEqual(e?.evidence, { file: 'features/orders/pages/OrdersPage.tsx', line: 1 });
  const q = queryGraph(g);
  assert.deepEqual(q.whoCalls('item:library/components/Button'), ['item:library/components/Card', LIST_PAGE, 'item:orders/components/OrderButton']);
  assert.ok(q.impactOf('item:library/components/Button').includes('item:billing/pages/InvoicesPage'), 'Button reaches InvoicesPage through OrderButton');
  assert.ok(q.impactOf('item:library/components/Button').includes('route:/billing'));
  assert.deepEqual(q.neighbors(ORDERS_PAGE, { layers: ['static'] }), [LIST_PAGE]);
  assert.deepEqual(q.neighbors(ORDERS_PAGE, { types: ['RENDERS'], depth: 2 }), ['item:library/components/Button', LIST_PAGE]);
});

test('static edges resolve symbols through path and import aliases (TypeScript checker, not text)', () => {
  const { graph: g } = buildLineGraph(copy(ALIAS));
  assertLineGraph(g);
  const shop = 'item:shop/pages/ShopPage';
  const pricing = 'item:library/workflows/pricing';
  const button = 'item:library/components/Button';
  assert.ok(has(g, shop, 'CALLS', pricing), 'sum() is total() from @lib/workflows/pricing');
  assert.deepEqual(g.edges.find((e) => e.from === shop && e.type === 'CALLS')?.evidence, { file: 'features/shop/pages/ShopPage.tsx', line: 7 });
  assert.ok(has(g, shop, 'USES_HOOK', pricing));
  assert.ok(has(g, shop, 'RENDERS', button));
  assert.ok(has(g, shop, 'HANDLES_EVENT', button));
  assert.ok(has(g, shop, 'IMPORTS', button) && has(g, shop, 'IMPORTS', pricing), 'alias imports are structure edges');
  assert.ok(has(g, shop, 'BASED_ON', 'item:library/pages/Page'));
  assert.equal(countOf(g, 'CALLS'), 1, 'a call inside its own file is no edge');
});

for (const [what, file, edit] of [
  ['a feature component', 'features/orders/components/OrderButton.tsx', (s) => s.replace("import { Button } from '../../../library/components/Button';", "import { Button } from '../../../library/components/Button';\nimport { Badge } from '../../../library/components/Badge';").replace('<Button label="Order" />', '<><Button label="Order" /><Badge text="new" /></>')],
  ['a library component', 'library/components/Button.tsx', (s) => s.replace('export function Button', 'export function Button2() {\n  return null;\n}\n\nexport function Button')],
]) {
  test(`an incremental update after editing ${what} equals a full rebuild`, () => {
    const a = copy(SAMPLE);
    buildLineGraph(a);
    fs.writeFileSync(path.join(a, file), edit(fs.readFileSync(path.join(a, file), 'utf8')));
    const inc = updateLineGraph(a, [file]);
    const b = copy(SAMPLE);
    fs.writeFileSync(path.join(b, file), edit(fs.readFileSync(path.join(b, file), 'utf8')));
    const full = buildLineGraph(b, { force: true });
    assert.equal(inc.stats.full, false);
    assert.ok(inc.stats.analyzed.includes(file));
    assert.ok(inc.stats.analyzed.length < full.stats.analyzed.length, `${inc.stats.analyzed.length} of ${full.stats.analyzed.length} files re-analysed`);
    assert.ok(!inc.stats.analyzed.includes('library/workflows/wizard.ts'), 'an unrelated file is not re-analysed');
    assert.deepEqual(strip(inc.graph), strip(full.graph));
    assert.deepEqual(strip(/** @type {any} */ (readLineGraph(a))), strip(full.graph), 'the stored graph is the rebuilt one');
  });
}

test('the incremental update re-analyses the files with edges into the changed one', () => {
  const a = copy(SAMPLE);
  buildLineGraph(a);
  const file = 'features/orders/components/OrderButton.tsx';
  fs.appendFileSync(path.join(a, file), '\nexport const ORDER = 1;\n');
  const { stats } = updateLineGraph(a, [file]);
  assert.deepEqual(stats.analyzed, ['features/billing/pages/InvoicesPage.tsx', file]);
});

test('a warm rebuild touches no unchanged file and writes nothing', () => {
  const root = copy(SAMPLE);
  const first = buildLineGraph(root);
  assert.equal(first.written, true);
  const f = graphFiles(root);
  const mtimes = [f.nodes, f.edges, f.index].map((r) => fs.statSync(path.join(root, r)).mtimeMs);
  const warm = buildLineGraph(root);
  assert.deepEqual(warm.stats.analyzed, []);
  assert.equal(warm.written, false);
  assert.deepEqual([f.nodes, f.edges, f.index].map((r) => fs.statSync(path.join(root, r)).mtimeMs), mtimes);
  assert.deepEqual(strip(warm.graph), strip(first.graph));
});

test('the stored graph keeps no code text and no embeddings: ids, labels, file:line and hashes only', () => {
  const root = copy(SAMPLE);
  buildLineGraph(root);
  const f = graphFiles(root);
  assert.deepEqual(fs.readdirSync(path.join(root, path.dirname(f.nodes))).sort(), ['edges.jsonl', 'index.json', 'nodes.jsonl']);
  const stored = [f.nodes, f.edges, f.index].map((r) => fs.readFileSync(path.join(root, r), 'utf8')).join('\n');
  const g = /** @type {any} */ (readLineGraph(root));
  for (const n of g.nodes) assert.deepEqual(Object.keys(n).filter((k) => !['id', 'kind', 'label', 'file', 'line', 'hash', 'attrs'].includes(k)), []);
  for (const e of g.edges) assert.deepEqual(Object.keys(e).sort(), ['evidence', 'from', 'layer', 'to', 'type']);
  // No number arrays (embeddings) anywhere.
  assert.ok(!/\[\s*-?\d+(\.\d+)?\s*,/.test(stored), 'no number arrays');
  // No source line of any file appears in the stored graph.
  for (const file of Object.keys(g.index.files)) {
    for (const raw of fs.readFileSync(path.join(root, file), 'utf8').split('\n')) {
      const l = raw.trim();
      if (l.length < 16 || l.startsWith('//') || l.startsWith('- ') || l.startsWith('#')) continue;
      assert.ok(!stored.includes(l), `the graph stores the code line "${l}" of ${file}`);
    }
  }
});

test('construct line graph prints a summary sentence and --json the counts', () => {
  const root = copy(SAMPLE);
  const cli = path.join(REPO, 'packages/cli/construct.mjs');
  const text = spawnSync(process.execPath, [cli, 'line', 'graph', '--dir', root], { encoding: 'utf8' });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^The Line graph has \d+ nodes \(17 items, \d+ logic units\) and \d+ edges: \d+ structure, \d+ static, 0 domain, \d+ process, 0 runtime \(17 files analysed, 0 reused\)\.\n/);
  const json = spawnSync(process.execPath, [cli, 'line', 'graph', '--dir', root, '--json'], { encoding: 'utf8' });
  assert.equal(json.status, 0, json.stderr);
  const out = JSON.parse(json.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.counts.byKind.item, 17);
  assert.deepEqual(out.stats.analyzed, []);
  assert.match(out.sentence, /^The Line graph has/);
});
