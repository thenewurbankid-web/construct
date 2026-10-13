// #919: spec points -> atom steps. On bench/ecommerce/SPEC.md the seed maps each behaviour point to the block that
// decides it (filter-sort, the cart block, validated-submit), leaves a point open with its reason when a block cannot
// decide it, emits nothing twice, and the code it lands type-checks; line.useAtom copies a shipped atom.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { parseSpecMd, specSteps } from '../packages/engine/line/seed/specSteps.mjs';
import { pointBlocks } from '../packages/engine/line/seed/atomSteps.mjs';
import { planUseAtom, atomSource } from '../packages/engine/line/seed/useAtom.mjs';
import { arrayFixtures, fixtureFor } from '../packages/engine/line/basePage.mjs';
import { atomImportsIn } from '../packages/line-atoms/check.mjs';
import { createPlanCli } from '../bench/ecommerce/driver/plan-cli.mjs';
import { parseToAst } from '@construct/ast';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BENCH = path.join(REPO, 'bench', 'ecommerce');
const SPEC_FILE = path.join(BENCH, 'SPEC.md');
const SPEC = parseSpecMd(fs.readFileSync(SPEC_FILE, 'utf8'));
const FIXTURES = arrayFixtures(path.join(BENCH, 'starter'), { library: 'library' });

/** A fresh copy of the bench starter; `modules` links the packages the starter's code imports (null when one is missing). */
function starter({ modules = false } = {}) {
  const parent = fs.realpathSync(makeTempDir('line-seed-atoms-'));
  const root = path.join(parent, 'shop');
  fs.cpSync(path.join(BENCH, 'starter'), root, { recursive: true, filter: (src) => !/node_modules|\.next/.test(src) });
  let linked = true;
  if (modules) {
    const want = ['react', 'react-dom', '@types/react', '@types/react-dom', '@types/node', 'next', 'xstate', '@radix-ui/react-label', '@radix-ui/react-select', '@radix-ui/react-checkbox', '@radix-ui/react-slot', '@radix-ui/react-toast', '@radix-ui/react-dialog'];
    for (const m of want) {
      const from = [path.join(REPO, 'node_modules', m), path.join(REPO, 'ui', 'client', 'node_modules', m)].find((p) => fs.existsSync(p));
      if (!from) { linked = false; break; }
      fs.mkdirSync(path.dirname(path.join(root, 'node_modules', m)), { recursive: true });
      fs.symlinkSync(fs.realpathSync(from), path.join(root, 'node_modules', m), 'dir');
    }
  }
  return { parent, root, linked, done: () => fs.rmSync(parent, { recursive: true, force: true }) };
}

test('pointBlocks on the bench SPEC.md: every behaviour point has its block and atom, nothing is left open', () => {
  const { points, blocks } = pointBlocks(SPEC, FIXTURES);
  const by = Object.fromEntries(points.map((p) => [p.id, [p.block, p.atom, p.decided]]));
  assert.deepEqual(by, {
    'CAT-2': ['filter-sort', 'filter-sort', true], 'CAT-3': ['filter-sort', 'filter-sort', true], 'CAT-4': ['filter-sort', 'filter-sort', true],
    'CART-1': ['cart', null, true], 'CART-2': ['cart', null, true], 'CART-3': ['cart', null, true], 'CART-4': ['cart', null, true],
    'CART-5': ['cart', null, true], 'CART-6': ['cart', null, true], 'CART-7': ['cart', null, true], 'CART-8': ['cart', null, true], 'PROD-2': ['cart', null, true],
    'CHK-1': ['checkout', 'validated-submit', true], 'CHK-2': ['checkout', 'validated-submit', true], 'CHK-3': ['checkout', null, true],
    'CHK-4': ['checkout', 'validated-submit', true], 'CHK-5': ['checkout', null, true], 'CHK-6': ['checkout', null, true],
  });
  // CAT-1, CAT-5, PROD-1, PROD-3 and PROD-4 are the page and route steps' (specSteps), not a behaviour block's.
  for (const id of ['CAT-1', 'CAT-5', 'PROD-1', 'PROD-3', 'PROD-4']) assert.ok(!(id in by), id);
  assert.deepEqual(blocks.filter.filter, { key: 'category', label: 'Category', all: 'All', values: ['Clothing', 'Home', 'Electronics'] });
  assert.deepEqual(blocks.filter.search, { label: 'Search', key: 'name' });
  assert.equal(blocks.filter.empty, 'No products found');
  assert.deepEqual(blocks.cart.rule, { fee: 5, freeFrom: 100 });
  assert.deepEqual(blocks.cart.labels, ['Subtotal', 'Shipping', 'Total']);
  assert.equal(blocks.cart.qtyPrefix, 'Quantity for ');
  assert.deepEqual(blocks.cart.add, { qtyLabel: 'Quantity', def: 1, min: 1, button: 'Add to cart', status: 'Added to cart', feature: 'product' });
  assert.deepEqual(blocks.checkout.fields.map((f) => [f.key, f.rule, f.message]), [
    ['fullName', 'required', 'Full name is required'], ['email', 'email', 'Enter a valid email'], ['address', 'required', 'Address is required'],
    ['city', 'required', 'City is required'], ['postalCode', 'digits', 'Postal code must be 5 digits'],
  ]);
  assert.deepEqual(blocks.checkout.checkbox, { key: 'terms', label: 'I accept the terms', message: 'Accept the terms to continue' });
  assert.deepEqual(blocks.checkout.done, { route: '/order/confirmation', heading: 'Thank you for your order', numberPrefix: 'Order #', link: { label: 'Continue shopping', route: '/' } });
});

test('a point no block can decide stays open for the model, with its reason', () => {
  const edit = (id, text) => ({ ...SPEC, features: SPEC.features.map((f) => ({ ...f, points: f.points.map((p) => (p.id === id ? { ...p, text } : p)) })) });
  const why = (spec, id) => pointBlocks(spec, FIXTURES).points.find((p) => p.id === id);
  // Options the fixture does not have: the filter is not decided, the search still is.
  const badFilter = edit('CAT-2', 'A filter labelled "Category" offers All, Shoes and Hats; choosing one shows only its products.');
  assert.deepEqual([why(badFilter, 'CAT-2').decided, why(badFilter, 'CAT-2').reason], [false, 'the options or the field do not match the fixture']);
  assert.equal(why(badFilter, 'CAT-3').decided, true);
  // A shipping rule in other words: the totals point is open, the rest of the cart is still seeded.
  const ship = edit('CART-5', 'The cart shows "Subtotal", "Shipping" and "Total": shipping depends on the region.');
  assert.match(why(ship, 'CART-5').reason, /^the shipping rule is not in the form/);
  assert.equal(why(ship, 'CART-2').decided, true);
  // A message that names no field: the whole checkout form is the model's.
  const msg = edit('CHK-2', 'Submitting with an empty or invalid field shows a message for each invalid field ("Something is off"); nothing is placed.');
  assert.equal(why(msg, 'CHK-1').decided, false);
  assert.match(why(msg, 'CHK-1').reason, /a message does not name its field/);
  // And specSteps lists them as open, so a builder sees what is left and why.
  const { root, done } = starter();
  try {
    const { open } = specSteps(root, { spec: ship });
    assert.deepEqual(open.map((o) => o.point), ['CART-5']);
  } finally { done(); }
});

test('#907 fix: a list page is wired to a fixture only when the spec says it lists all of it (the cart lists "each product in it")', () => {
  const cart = SPEC.features.find((f) => f.name === 'cart');
  const text = cart.points.map((p) => p.text).join('\n');
  assert.equal(fixtureFor(FIXTURES, 'cart', text, 'list'), null);
  assert.equal(fixtureFor(FIXTURES, 'cart', text)?.stem, 'products', 'a detail or plain lookup still finds it');
  assert.equal(fixtureFor(FIXTURES, 'catalog', SPEC.features[0].points[0].text, 'list')?.stem, 'products');
  assert.equal(fixtureFor(FIXTURES, 'products', 'Nothing here.', 'list')?.stem, 'products', 'a feature named after the fixture');
});

test('line.useAtom copies a shipped atom with its types inlined; refuses an unknown atom, a second copy and a changed file', () => {
  const { root, done } = starter();
  try {
    const c = planUseAtom(root, { atom: 'filter-sort' });
    assert.deepEqual(c.files.map((f) => f.path), ['library/atoms/filter-sort.ts']);
    assert.match(c.files[0].content, /^\/\/ @line-atom filter-sort: copied from @line\/atoms\/filter-sort/);
    assert.match(c.files[0].content, /export interface AtomMachine<S, E extends AtomEventBase, I>/);
    assert.doesNotMatch(c.files[0].content, /from '\.\.\/types\.ts'/);
    assert.throws(() => planUseAtom(root, { atom: 'filter-sorting' }), (e) => e.code === 'UNKNOWN_ITEM' && e.fixes?.[0]?.step?.args?.atom === 'filter-sort');
    fs.mkdirSync(path.join(root, 'library/atoms'), { recursive: true });
    fs.writeFileSync(path.join(root, 'library/atoms/filter-sort.ts'), atomSource('filter-sort'));
    assert.throws(() => planUseAtom(root, { atom: 'filter-sort' }), (e) => e.code === 'NO_CHANGE');
    fs.writeFileSync(path.join(root, 'library/atoms/filter-sort.ts'), '// mine\n');
    assert.throws(() => planUseAtom(root, { atom: 'filter-sort' }), (e) => e.code === 'STALE');
  } finally { done(); }
});

test('LINE-ATOM counts an import of a copied atom (library/atoms/<id>) as using the atom', () => {
  const ast = parseToAst("import { filterSort } from '../../../library/atoms/filter-sort';\nimport x from './atoms/not-an-atom';\n");
  assert.deepEqual(atomImportsIn(ast), [{ id: 'filter-sort', line: 1 }]);
});

test('plan-cli seed on a fresh starter: the atom and block steps land after the pages and routes, a second pass emits nothing, and the project type-checks', async (t) => {
  const { parent, root, linked, done } = starter({ modules: true });
  if (!linked) { done(); t.skip('the packages the starter imports (react, next, Radix) are not installed in this checkout'); return; }
  try {
    const cli = createPlanCli({ project: root, log: path.join(parent, 'logs', 'calls.jsonl'), builder: 'test', spec: SPEC_FILE, shadowJev: false });
    const out = await cli.run('seed');
    assert.equal(out.ok, true, out.sentence);
    assert.ok(out.steps.every((s) => s.landed));
    const behaviour = out.steps.slice(12).map((s) => [s.tool, s.args.atom ?? s.args.file ?? s.args.route ?? s.args.slot ?? s.args.name]);
    assert.deepEqual(behaviour, [
      ['line.useAtom', 'filter-sort'], ['line.setCode', 'features/catalog/usecases/filterProducts.ts'], ['line.setCode', 'features/catalog/pages/CatalogPage.tsx'],
      ['line.setCode', 'library/services/cart.ts'], ['line.setCode', 'library/usecases/useCart.ts'], ['line.setCode', 'library/components/CartLink.tsx'],
      ['line.setLayoutSlot', 'nav'], ['line.setCode', 'library/components/AddToCart.tsx'], ['line.setCode', 'features/product/pages/ProductPage.tsx'],
      ['line.setCode', 'features/cart/pages/CartPage.tsx'], ['line.useAtom', 'validated-submit'], ['line.setCode', 'features/checkout/services/orders.ts'],
      ['line.setCode', 'features/checkout/usecases/placeOrder.ts'], ['line.setCode', 'features/checkout/pages/CheckoutPage.tsx'],
      ['line.baseOn', 'ConfirmationPage'], ['line.addRoute', '/order/confirmation'], ['line.setCode', 'features/checkout/pages/ConfirmationPage.tsx'],
    ]);
    assert.deepEqual(out.open, []);
    const cartPage = fs.readFileSync(path.join(root, 'features/cart/pages/CartPage.tsx'), 'utf8');
    assert.doesNotMatch(cartPage, /fixtures\/products/, 'the cart page lists the cart, not the catalog');
    assert.match(cartPage, /^\/\/ @line-base pages\/ListPage\n\/\/ @line-route \/cart\n'use client';/);
    assert.match(fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8'), /nav=\{<><CartLink \/><\/>\}/);
    // Idempotent: nothing left to seed, and running it again lands nothing.
    assert.deepEqual(specSteps(root, { spec: SPEC }).steps, []);
    assert.equal((await cli.run('seed')).steps.length, 0);
    // The seeded project type-checks as a whole (each setCode was already gated file by file). tailwind.config.ts is the
    // starter's build config, untouched by the seed, and tailwindcss is not installed in this repository.
    fs.rmSync(path.join(root, 'tailwind.config.ts'));
    execFileSync(process.execPath, [path.join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', root], { stdio: 'pipe', encoding: 'utf8' });
  } finally { done(); }
});
