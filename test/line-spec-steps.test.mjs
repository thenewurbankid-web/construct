// #914: spec -> steps. On the bench starter and bench/ecommerce/SPEC.md the pass emits, with no model, the steps a block
// can decide (the catalog spec, the missing features, a wired page on the fitting library page per routed page, its
// route) stub-first with a why naming the spec point; nothing for a point no block decides; and nothing twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { parseSpecMd, specSteps, seedText } from '../packages/engine/line/seed/specSteps.mjs';
import { createPlanCli } from '../bench/ecommerce/driver/plan-cli.mjs';
import { seedFirst, flags } from '../bench/ecommerce/driver/qwen-agent.mjs';
import { planSeed } from '../packages/mcp/src/plan.mjs';

const BENCH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'ecommerce');
const SPEC_FILE = path.join(BENCH, 'SPEC.md');
const SPEC_TEXT = fs.readFileSync(SPEC_FILE, 'utf8');
const SPEC = parseSpecMd(SPEC_TEXT);

/** A fresh copy of the bench starter (no node_modules). */
function starter() {
  const parent = fs.realpathSync(makeTempDir('line-spec-steps-'));
  const root = path.join(parent, 'shop');
  fs.cpSync(path.join(BENCH, 'starter'), root, { recursive: true, filter: (src) => !/node_modules|\.next/.test(src) });
  return { parent, root, done: () => fs.rmSync(parent, { recursive: true, force: true }) };
}
const brief = (s) => [s.tool, s.tool === 'line.createFeature' ? s.args.name : s.tool === 'line.setCode' ? s.args.file : s.tool === 'line.baseOn' ? `${s.args.feature}/${s.args.name} ${s.args.libraryId}` : `${s.args.route} ${s.args.page}`];

test('parseSpecMd: the bench SPEC.md has 4 features with 22 points and a route table of 5 routes in Line form', () => {
  assert.deepEqual(SPEC.features.map((f) => [f.name, f.points.length]), [['catalog', 5], ['product', 4], ['cart', 8], ['checkout', 6]]);
  assert.deepEqual(SPEC.routes.map((r) => [r.route, r.feature]), [['/', 'catalog'], ['/products/:id', 'product'], ['/cart', 'cart'], ['/checkout', 'checkout'], ['/order/confirmation', 'checkout']]);
  assert.match(SPEC.features[0].story, /^As a shopper, I want to browse and search the products/);
});

test('the starter: the steps in plan order, stub-first per feature, each with a why naming its spec point', () => {
  const { root, done } = starter();
  try {
    const { steps } = specSteps(root, { spec: SPEC });
    assert.deepEqual(steps.map(brief), [
      ['line.setCode', 'features/catalog/spec.md'],
      ['line.baseOn', 'catalog/CatalogPage pages/ListPage'],
      ['line.addRoute', '/ features/catalog/pages/CatalogPage.tsx'],
      ['line.createFeature', 'product'],
      ['line.baseOn', 'product/ProductPage pages/DetailPage'],
      ['line.addRoute', '/products/:id features/product/pages/ProductPage.tsx'],
      ['line.createFeature', 'cart'],
      ['line.baseOn', 'cart/CartPage pages/ListPage'],
      ['line.addRoute', '/cart features/cart/pages/CartPage.tsx'],
      ['line.createFeature', 'checkout'],
      ['line.baseOn', 'checkout/CheckoutPage pages/FormPage'],
      ['line.addRoute', '/checkout features/checkout/pages/CheckoutPage.tsx'],
    ]);
    assert.deepEqual(steps.map((s) => s.kind), ['feature', 'page', 'route', 'feature', 'page', 'route', 'feature', 'page', 'route', 'feature', 'page', 'route']);
    assert.match(steps[1].why, /^CAT-1 puts a page at \/: CatalogPage is based on the library ListPage, wired to library\/fixtures\/products\.json\.$/);
    assert.match(steps[2].why, /^CAT-1 puts a page at \/: serve CatalogPage there\.$/);
    assert.match(steps[3].why, /feature product \(PROD-1, PROD-2, PROD-3, PROD-4\)/);
    assert.equal(steps[3].args.points[0].slice(0, 7), 'PROD-1:');
    // The placeholder catalog spec is replaced at the hash it has now, so baseOn wires the page from the real points.
    assert.match(steps[0].args.code, /^# catalog\n\n## As a shopper, I want to browse/);
    assert.equal(typeof steps[0].args.contentHash, 'string');
    for (const s of steps) assert.match(s.why, /^[A-Z].*\.$/, `${s.tool} has a why that starts with a capital and ends with a full stop`);
    assert.match(seedText(steps).split('\n')[0], /^1\. line\.setCode \{"file":"features\/catalog\/spec\.md"\}: /);
  } finally { done(); }
});

test('the library base per route: list for "/" and "/cart", detail for the :param route, form for checkout; list and detail are wired to the fixture', () => {
  const { root, done } = starter();
  try {
    const pages = specSteps(root, { spec: SPEC }).steps.filter((s) => s.kind === 'page');
    assert.deepEqual(pages.map((s) => [s.route, s.base, s.fixture ?? null]), [
      ['/', 'pages/ListPage', 'library/fixtures/products.json'],
      ['/products/:id', 'pages/DetailPage', 'library/fixtures/products.json'],
      ['/cart', 'pages/ListPage', 'library/fixtures/products.json'],
      ['/checkout', 'pages/FormPage', null],
    ]);
  } finally { done(); }
});

test('nothing for points a block cannot decide: behaviour points get no step, a list fallback the spec does not ask for and a route only mentioned are not seeded', () => {
  const { root, done } = starter();
  try {
    const { steps, skipped } = specSteps(root, { spec: SPEC });
    assert.deepEqual([...new Set(steps.filter((s) => s.kind !== 'feature').map((s) => s.point))], ['CAT-1', 'PROD-1', 'CART-2', 'CHK-1']);
    assert.ok(!steps.some((s) => s.route === '/order/confirmation'));
    assert.deepEqual(skipped, [{ kind: 'page', feature: 'checkout', route: '/order/confirmation', reason: 'the spec does not say which library page fits it' }]);
    // Without the route table, a route a point only mentions ("opens `/order/confirmation`") is not even considered.
    const noTable = { features: SPEC.features };
    const r = specSteps(root, { spec: noTable });
    assert.deepEqual(r.steps.filter((s) => s.kind === 'route').map((s) => s.args.route), ['/', '/products/:id', '/cart', '/checkout']);
    assert.deepEqual(r.skipped, []);
    // A feature whose points put no page anywhere gets only its feature step.
    const bare = { features: [{ name: 'wishlist', story: 'As a shopper, I want a wishlist, so that I can come back later', points: [{ id: 'WISH-1', text: 'A "Save" button keeps the product for later.' }] }] };
    assert.deepEqual(specSteps(root, { spec: bare }).steps.map(brief), [['line.createFeature', 'wishlist']]);
  } finally { done(); }
});

test('idempotent: planned steps are skipped, and after plan-cli seed lands them a second pass emits nothing', async () => {
  const { parent, root, done } = starter();
  try {
    const first = specSteps(root, { spec: SPEC }).steps;
    const planned = first.slice(0, 2).map((s) => ({ tool: s.tool, args: s.args, state: 'ready' }));
    const again = specSteps(root, { spec: SPEC, planned });
    assert.deepEqual(again.steps.map(brief), first.slice(2).map(brief));
    assert.deepEqual(again.skipped.slice(0, 2).map((s) => s.reason), ['the plan already has line.setCode for it', 'the plan already has line.baseOn for it']);
    // A done step is not "planned": its effect is on disk (or nowhere), so the disk decides.
    assert.equal(specSteps(root, { spec: SPEC, planned: planned.map((s) => ({ ...s, state: 'done' })) }).steps.length, first.length);

    const log = path.join(parent, 'logs', 'calls.jsonl');
    const cli = createPlanCli({ project: root, log, builder: 'test', spec: SPEC_FILE, shadowJev: false });
    const out = await cli.run('seed');
    assert.equal(out.ok, true, out.sentence);
    assert.equal(out.steps.length, 12);
    assert.ok(out.steps.every((s) => s.landed));
    assert.match(out.sentence, /^Seeded 12 steps from the spec: features\/catalog\/spec\.md; catalog\/CatalogPage on pages\/ListPage; \/ -> features\/catalog\/pages\/CatalogPage\.tsx;/);
    assert.match(out.steps[0].args.code, /^<\d+ characters>$/, 'the spec text is not repeated in the answer or the log');
    for (const [entry, page] of [['app/page.tsx', 'CatalogPage'], ['app/products/[id]/page.tsx', 'ProductPage'], ['app/cart/page.tsx', 'CartPage'], ['app/checkout/page.tsx', 'CheckoutPage']]) {
      assert.match(fs.readFileSync(path.join(root, entry), 'utf8'), new RegExp(`export \\{ ${page} as default \\}`));
    }
    assert.match(fs.readFileSync(path.join(root, 'features/catalog/pages/CatalogPage.tsx'), 'utf8'), /import products from '..\/..\/..\/library\/fixtures\/products\.json';/);
    const seedLog = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.kind === 'seed');
    assert.equal(seedLog.length, 1);
    assert.equal(seedLog[0].steps.length, 12);
    assert.equal(seedLog[0].steps[1].fixture, 'library/fixtures/products.json');

    assert.deepEqual(specSteps(root, { spec: SPEC }).steps, []);
    const twice = await cli.run('seed');
    assert.equal(twice.ok, true);
    assert.equal(twice.steps.length, 0);
    assert.match(twice.sentence, /^Seeded 0 steps from the spec\./);
  } finally { done(); }
});

test('qwen-agent --seed-plan: off by default; seedFirst puts what was seeded into the first message', async () => {
  assert.equal(flags([]).seedPlan, false);
  assert.equal(flags(['--seed-plan', '--project', 'x']).seedPlan, true);
  assert.equal(flags(['--seed-plan', '--project', 'x']).project, 'x');
  const calls = [];
  const cli = { run: async (cmd) => { calls.push(cmd); return { ok: true, steps: [{ tool: 'line.addRoute', landed: true }], sentence: 'Seeded 1 step from the spec: / -> features/catalog/pages/CatalogPage.tsx.\nOpen work: 3 items remain.' }; } };
  const s = await seedFirst(cli);
  assert.deepEqual(calls, ['seed']);
  assert.equal(s.ok, true);
  assert.match(s.content, /^Line already ran the steps a block can decide from the spec; continue from there\.\nSeeded 1 step/);
  assert.match(s.content, /Call finish when every acceptance point is done/);
});

test('MCP plan_seed: the steps from the project\'s SPEC.md, none without one', async () => {
  const { root, done } = starter();
  try {
    const none = await planSeed({ root });
    assert.deepEqual(none.steps, []);
    assert.match(none.sentence, /no SPEC\.md/);
    fs.writeFileSync(path.join(root, 'SPEC.md'), SPEC_TEXT);
    const r = await planSeed({ root });
    assert.equal(r.steps.length, 12);
    assert.match(r.sentence, /^12 steps can be decided from the spec; add them in order with plan_add_step, starting with line\.setCode/);
  } finally { done(); }
});
