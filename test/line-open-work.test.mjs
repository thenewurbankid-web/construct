// #908: plan answers list each feature's unfinished work. The fixture is bench run data-qwen3-4b-r1's end state: catalog
// has a fresh line.baseOn ListPage wrapper that no route serves and that renders no items, cart has a routed page and the
// points the model invented. Before #908 plan status said "current feature: cart" and nothing about catalog.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { openWork, workText, pointLabels } from '../packages/engine/line/openWork.mjs';
import { createLinePlanService } from '../packages/engine/line/planService.mjs';
import { readSpec, currentFeature } from '../bench/ecommerce/driver/spec-slice.mjs';

const STARTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'ecommerce', 'starter');
const CATALOG_PAGE = 'features/catalog/pages/CatalogPage.tsx';

/** A copy of the bench starter at the 4b run's end state. */
function fourB() {
  const parent = fs.realpathSync(makeTempDir('line-open-work-'));
  const root = path.join(parent, 'shop');
  fs.cpSync(STARTER, root, { recursive: true, filter: (src) => !/node_modules|\.next/.test(src) });
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  put('features/catalog/spec.md', '# catalog\n\n## As a shopper, I want to browse and search the products, so that I can find one to buy\n\n- CAT-1: The page at `/` has the main heading "Products" and lists all 12 products.\n');
  put(CATALOG_PAGE, "// @line-base pages/ListPage\nimport type { ComponentProps } from 'react';\nimport { ListPage } from '../../../library/pages/ListPage';\n\nexport function CatalogPage(props: ComponentProps<typeof ListPage> & object) {\n  return <ListPage {...props} />;\n}\n");
  put('features/cart/spec.md', '# cart\n\n## As a shopper, I want a cart, so that I can buy things\n\n- Add items to the cart\n- Remove items from the cart\n');
  put('features/cart/pages/CartPage.tsx', "// @line-base pages/DetailPage\n// @line-route /cart\nimport { DetailPage } from '../../../library/pages/DetailPage';\n\nexport function CartPage() {\n  return (\n    <DetailPage title=\"Your cart\">\n      <p>Your cart is empty</p>\n    </DetailPage>\n  );\n}\n");
  put('app/cart/page.tsx', "export { CartPage as default } from '../../features/cart/pages/CartPage';\n");
  return { root, done: () => fs.rmSync(parent, { recursive: true, force: true }) };
}

test('pointLabels: quoted labels, cut before a placeholder and an example count; lower-case input examples are not labels', () => {
  assert.deepEqual(pointLabels('A link whose name starts with "Cart", like "Cart (3)"; it opens `/cart`.'), ['Cart']);
  assert.deepEqual(pointLabels('a quantity field labelled "Quantity for <product name>" and "Remove <product name>"'), ['Quantity for', 'Remove']);
  assert.deepEqual(pointLabels('A search box labelled "Search" filters ("mug" shows only Ceramic Mug)'), ['Search']);
});

test('4b end state against SPEC.md: catalog is current, with the empty page, the exact addRoute step and its open points', () => {
  const { root, done } = fourB();
  try {
    const w = openWork(root, { spec: readSpec() });
    assert.equal(w.current, 'catalog');
    assert.deepEqual(w.features.map((f) => [f.name, f.open.map((o) => o.kind)]), [
      ['catalog', ['data', 'route', 'point', 'point', 'point', 'point']],
      ['product', ['feature']],
      ['cart', ['point', 'point', 'point', 'point', 'point']],
      ['checkout', ['feature']],
    ]);
    assert.equal(w.count, 13);
    const cat = w.features[0];
    // The wrapper only forwards its props, so its content comes before its route (a route cannot serve a page with props).
    assert.match(cat.open[0].sentence, /^CatalogPage renders ListPage with no content: it passes no children and imports no data \(the library has library\/fixtures\/products\.json\)\./);
    assert.equal(cat.open[0].step, undefined);
    assert.deepEqual(cat.open[1].step, { tool: 'line.addRoute', args: { route: '/', page: CATALOG_PAGE } });
    assert.deepEqual(cat.open.slice(2).map((o) => o.point.id), ['CAT-1', 'CAT-2', 'CAT-3', 'CAT-4']);
    assert.match(cat.open[2].sentence, /^CAT-1 is not covered yet: no file of catalog has "Products"\.$/);
    assert.equal(cat.points.find((p) => p.id === 'CAT-5').covered, null, 'a point with no labels is not judged');
    const product = w.features[1];
    assert.equal(product.open[0].step.tool, 'line.createFeature');
    assert.equal(product.open[0].step.args.name, 'product');
    assert.match(product.open[0].step.args.points[0], /^PROD-1: The page at `\/products\/<id>`/);
    const cart = w.features[2];
    assert.deepEqual(cart.open.map((o) => o.point.id), ['CART-1', 'CART-2', 'CART-4', 'CART-5', 'CART-8']);
    assert.match(cart.open[0].sentence, /no file of cart has "Cart"/, '"Cart" inside CartPage is not the label');
    assert.equal(cart.points.find((p) => p.id === 'CART-6').covered, true);
    // The spec's points, not the invented ones, are the cart's points.
    assert.deepEqual(cart.points.map((p) => p.id), ['CART-1', 'CART-2', 'CART-3', 'CART-4', 'CART-5', 'CART-6', 'CART-7', 'CART-8']);
    const text = workText(w);
    assert.match(text, /^Open work: 13 items remain \(catalog 6, product 1, cart 5, checkout 1\)\.\nCurrent feature: catalog \(As a shopper, I want to browse/);
    assert.match(text, /\n2\. CatalogPage is served at no route; serve it at \/\. Step: line\.addRoute \{"route":"\/","page":"features\/catalog\/pages\/CatalogPage\.tsx"\}\n/);
    assert.match(text, /\n- CAT-1 \[open\]: The page at `\/` has the main heading "Products"/);
    assert.equal(text.split('\n').filter((l) => l.startsWith('- ')).length, 5);
    assert.equal(workText(w, { cap: 3, feature: 'cart' }).split('\n').filter((l) => l.startsWith('- ')).length, 3);
    // The bench driver's current feature follows the open work, not the last feature touched.
    assert.equal(currentFeature(readSpec(), w).name, 'catalog');
    assert.equal(currentFeature(readSpec(), null).name, 'catalog');
  } finally { done(); }
});

test('4b end state with no target spec: each feature\'s own spec.md; cart has nothing open, so catalog is current', () => {
  const { root, done } = fourB();
  try {
    const w = openWork(root);
    assert.deepEqual(w.features.map((f) => f.name), ['cart', 'catalog']);
    assert.deepEqual(w.features[0].open, []);
    assert.equal(w.current, 'catalog');
    assert.deepEqual(w.features[1].open.map((o) => o.kind), ['data', 'route', 'point']);
    assert.deepEqual(w.features[1].open[1].step, { tool: 'line.addRoute', args: { route: '/', page: CATALOG_PAGE } });
  } finally { done(); }
});

test('a routed page with content and covered points leaves nothing open', () => {
  const { root, done } = fourB();
  try {
    fs.writeFileSync(path.join(root, CATALOG_PAGE), "// @line-base pages/ListPage\n// @line-route /\nimport { ListPage } from '../../../library/pages/ListPage';\nimport products from '../../../library/fixtures/products.json';\n\nexport function CatalogPage() {\n  return (\n    <ListPage title=\"Products\">\n      {products.map((p) => <p key={p.id}>{p.name}</p>)}\n    </ListPage>\n  );\n}\n");
    const w = openWork(root);
    assert.equal(w.count, 0);
    assert.equal(w.current, null);
    assert.match(workText(w), /^Open work: none;/);
  } finally { done(); }
});

test('plan service: the view carries the work card; run-next says how many items remain and the first, and the cap grows on a repeat', async () => {
  const { root, done } = fourB();
  try {
    const svc = createLinePlanService({ root, commands: null, trace: null, records: null, memory: null, spec: () => readSpec() });
    const v = /** @type {any} */ (await svc.view());
    assert.equal(v.work.current, 'catalog');
    assert.equal(v.work.cap, 5);
    assert.match(v.work.text, /Current feature: catalog/);
    const land = async (tool, args) => {
      const a = /** @type {any} */ (await svc.addStep({ tool, args, why: `Run ${tool.replace('.', ' ')} for the test.` }, 'agent'));
      assert.equal(a.ok, true, a.text ?? a.sentence);
      assert.equal(a.work.current, 'catalog');
      const ap = /** @type {any} */ (await svc.approve(a.stepId, 'ui'));
      assert.equal(ap.ok, true, ap.sentence);
      const r = /** @type {any} */ (await svc.runNext('agent'));
      assert.equal(r.ok, true, r.text ?? r.sentence);
      return r;
    };
    const r1 = await land('line.addRoute', { route: '/', page: CATALOG_PAGE });
    assert.equal(r1.steps.at(-1).state, 'done', r1.steps.at(-1).sentence);
    assert.match(r1.remain, /^12 open items remain; next: CatalogPage renders ListPage with no content/);
    assert.ok(!r1.work.features[0].open.some((o) => o.kind === 'route'), 'the route item is gone once the route landed');
    const r2 = await land('line.baseOn', { libraryId: 'components/Card', feature: 'catalog', name: 'ProductCard' });
    assert.match(r2.remain, /^12 open items remain; next: CatalogPage renders ListPage/);
    // The same first item outlived two run-nexts: the card's cap grows (#886).
    assert.equal(/** @type {any} */ (await svc.view()).work.cap, 15);
  } finally { done(); }
});

test('bench plan-cli: status, add and run-next all carry the open-work card with the current feature\'s points', async () => {
  const { createPlanCli } = await import('../bench/ecommerce/driver/plan-cli.mjs');
  const { root, done } = fourB();
  try {
    const log = path.join(root, '..', 'log', 'calls.jsonl');
    const cli = createPlanCli({ project: root, log, builder: 'test', shadowJev: false });
    const st = await cli.run('status');
    assert.match(st.sentence, /^The plan has 0 steps\.\nOpen work: 13 items remain \(catalog 6, product 1, cart 5, checkout 1\)\.\nCurrent feature: catalog /);
    assert.deepEqual(st.work, { current: 'catalog', count: 13 });
    assert.match((await cli.run('status', ['cart'])).sentence, /\nCurrent feature: cart \(As a shopper, I want a cart I can change/);
    const add = await cli.run('add', ['line.addRoute', JSON.stringify({ route: '/', page: CATALOG_PAGE })], { why: 'Serve the catalog page at the root.' });
    assert.equal(add.ok, true, add.sentence);
    assert.match(add.sentence, /\nCurrent feature: catalog /);
    const ran = await cli.run('run-next');
    assert.equal(ran.landed, true, ran.sentence);
    assert.match(ran.remain, /^12 open items remain; next: CatalogPage renders ListPage/);
    assert.match(ran.sentence, /^Saved: Serves CatalogPage of feature catalog at \/\.\nOpen work: 12 items remain .*\n- CAT-1 \[open\]: /s);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.kind === 'call');
    assert.match(calls.at(-1).result.remain, /^12 open items remain/);
    assert.match(calls.at(-1).result.shown, /Current feature: catalog/);
  } finally { done(); }
});
