// #933: the seed and the open-work suggestions are derived from the spec, not from shop recipes. On bench/lending/SPEC.md
// (held out: only SPEC.md and the starter's fixtures are read, never acceptance/) every route gets its page on the
// library page of its shape, the picks and loans are a store not the fixture, and nothing says cart or checkout; on
// bench/ecommerce/SPEC.md the seed lands the same steps and the same files it landed before #933.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { parseSpecMd, specSteps } from '../packages/engine/line/seed/specSteps.mjs';
import { pageShape, routeEvidence, pointRole, memberState } from '../packages/engine/line/seed/pageShape.mjs';
import { pointBlocks, RECIPES } from '../packages/engine/line/seed/atomSteps.mjs';
import { arrayFixtures } from '../packages/engine/line/basePage.mjs';
import { openWork, pointStep } from '../packages/engine/line/openWork.mjs';
import { createPlanCli } from '../bench/ecommerce/driver/plan-cli.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const bench = (name) => {
  const dir = path.join(REPO, 'bench', name);
  return { dir, specFile: path.join(dir, 'SPEC.md'), spec: parseSpecMd(fs.readFileSync(path.join(dir, 'SPEC.md'), 'utf8')) };
};
const LENDING = bench('lending');
const SHOP = bench('ecommerce');

/** A fresh copy of a bench starter under a construct-* temp dir (no node_modules), removed by `done`. */
function starter(b) {
  const parent = fs.realpathSync(makeTempDir('construct-seed-spec-'));
  const root = path.join(parent, 'p');
  fs.cpSync(path.join(b.dir, 'starter'), root, { recursive: true, filter: (src) => !/node_modules|\.next/.test(src) });
  return { parent, root, done: () => fs.rmSync(parent, { recursive: true, force: true }) };
}
const shapeOf = (b, route) => {
  const r = b.spec.routes.find((x) => x.route === route);
  const f = b.spec.features.find((x) => x.name === r.feature);
  const routes = b.spec.routes.filter((x) => x.feature === f.name).map((x) => x.route);
  return pageShape({ route, points: routeEvidence(f, route, routes), label: r.page });
};

test('pageShape on both specs: the closed set (list, form, detail) from the points about each page and its route', () => {
  assert.deepEqual(['/', '/books/:id', '/picks', '/request', '/request/done', '/loans'].map((r) => [r, shapeOf(LENDING, r).shape]),
    [['/', 'list'], ['/books/:id', 'detail'], ['/picks', 'list'], ['/request', 'form'], ['/request/done', 'detail'], ['/loans', 'list']]);
  assert.deepEqual(['/', '/products/:id', '/cart', '/checkout', '/order/confirmation'].map((r) => [r, shapeOf(SHOP, r).shape]),
    [['/', 'list'], ['/products/:id', 'detail'], ['/cart', 'list'], ['/checkout', 'form'], ['/order/confirmation', null]]);
  // Why, in the spec's own words: browse is a paginated list, not the detail page its link to /books/<id> once suggested.
  assert.match(shapeOf(LENDING, '/').reason, /^BRW-1.*reads as a list \(.*at a time.*Page N of M/);
  assert.match(shapeOf(LENDING, '/request').reason, /^REQ-1 reads as a form \(fields labelled/);
  // Undecided: nothing said, or both a list and one record.
  assert.match(shapeOf(SHOP, '/order/confirmation').reason, /^no point says what the page at \/order\/confirmation shows/);
  const both = pageShape({ route: '/x', points: [{ id: 'X-1', text: 'Lists each order with its total, and shows the order number (text starting "No. ").' }] });
  assert.equal(both.shape, null);
  assert.match(both.reason, /reads both as a list \(X-1: lists\) and as one record \(X-1: one record's number\)/);
  // Roles: a count link every page shows is the nav slot; a "with no X ... says" text is the empty slot.
  assert.deepEqual(pointRole(LENDING.spec.features[2].points[0].text), { role: 'nav-count', label: 'My picks' });
  assert.deepEqual(pointRole(LENDING.spec.features[2].points[4].text), { role: 'empty', text: 'You have not picked any books yet' });
  // The member's own selection: the picks (added to from the book page, counted on every page, kept on reload) and the loans.
  assert.ok(memberState(LENDING.spec, 'picks', ['/picks']).because.some((b) => /^PCK-1: every page shows their count$/.test(b)));
  assert.ok(memberState(LENDING.spec, 'loans', ['/loans']));
  assert.equal(memberState(LENDING.spec, 'browse', ['/']), null);
});

test('lending seed: a page and a route for every route, on the library page of its shape; the store, not the fixture, for the picks and loans', () => {
  const { root, done } = starter(LENDING);
  try {
    const { steps, skipped, open } = specSteps(root, { spec: LENDING.spec });
    const pages = steps.filter((s) => s.kind === 'page').map((s) => [s.route, s.base, s.fixture ?? null]);
    assert.deepEqual(pages, [
      ['/', 'pages/ListPage', 'library/fixtures/books.json'],
      ['/books/:id', 'pages/DetailPage', 'library/fixtures/books.json'],
      ['/picks', 'pages/ListPage', null],
      ['/request', 'pages/FormPage', null],
      ['/request/done', 'pages/DetailPage', null],
      ['/loans', 'pages/ListPage', null],
    ]);
    assert.deepEqual(steps.filter((s) => s.kind === 'route').map((s) => s.args.route), ['/', '/books/:id', '/picks', '/request', '/request/done', '/loans']);
    assert.deepEqual(skipped.filter((s) => s.kind !== 'behaviour'), []);
    // Open for the builder, in the spec's words: the stores, the nav count link, the empty slots.
    const why = Object.fromEntries(open.map((o) => [o.point, o.reason]));
    assert.match(why['PCK-2'], /^the picks are the member's own selection \(.*PCK-1: every page shows their count.*\): keep them in a library store \(construct create store Picks --feature picks --shape list\) and list it at \/picks, not a fixture$/);
    assert.match(why['PCK-1'], /^every page shows a link "My picks \(<count>\)" to \/picks: a component in the app shell's nav slot \(line\.setLayoutSlot nav\)/);
    assert.match(why['LN-1'], /construct create store Loans --feature loans --shape list.*; and "You have no loans" is the empty slot of the list page at \/loans/);
    assert.match(why['PCK-5'], /^"You have not picked any books yet" is the empty slot of the list page at \/picks/);
    // No shop recipe matches, so no shop word leaks into the seed.
    assert.deepEqual(pointBlocks(LENDING.spec, arrayFixtures(path.join(LENDING.dir, 'starter'), { library: 'library' })).points, []);
    assert.doesNotMatch(JSON.stringify({ steps, skipped, open }), /cart|checkout/i);
  } finally { done(); }
});

test('lending open work: browse is suggested on ListPage (not DetailPage), and a picks page is told to use a store, not books.json', async () => {
  const { parent, root, done } = starter(LENDING);
  try {
    const fresh = openWork(root, { spec: LENDING.spec });
    const browse = fresh.features.find((f) => f.name === 'browse');
    assert.match(browse.open.find((i) => i.kind === 'page').sentence, /create one with line\.baseOn on the library ListPage \(BRW-1/);
    for (const id of ['BRW-1', 'BRW-2']) {
      assert.deepEqual(browse.open.find((i) => i.point?.id === id).step, { tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature: 'browse', name: 'BrowsePage' } });
    }
    const cli = createPlanCli({ project: root, log: path.join(parent, 'logs', 'calls.jsonl'), builder: 'test', spec: LENDING.specFile, shadowJev: false });
    const out = await cli.run('seed');
    assert.equal(out.ok, true, out.sentence);
    assert.equal(out.steps.length, 17);
    assert.ok(out.steps.every((s) => s.landed));
    const { sentence, steps, skipped, open } = out;
    assert.doesNotMatch(JSON.stringify({ sentence, steps, skipped, open }), /cart|checkout/i);
    const seeded = openWork(root, { spec: LENDING.spec });
    const data = (feature) => seeded.features.find((f) => f.name === feature).open.find((i) => i.kind === 'data')?.sentence ?? '';
    assert.match(data('picks'), /imports no data \(they are the member's own selection, .*construct create store Picks --feature picks --shape list, not a fixture\)/);
    assert.doesNotMatch(data('picks'), /books\.json/);
    assert.doesNotMatch(data('request'), /books\.json/, 'the request confirmation is not a book record');
    assert.match(fs.readFileSync(path.join(root, 'features/browse/pages/BrowsePage.tsx'), 'utf8'), /import books from '\.\.\/\.\.\/\.\.\/library\/fixtures\/books\.json';/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'features/request/pages/DonePage.tsx'), 'utf8'), /books\.json/);
  } finally { done(); }
});

test('pointStep: no page yet -> <Feature>Page on the shape the feature\'s points give its page; undecided -> no step', () => {
  const libs = ['pages/DetailPage', 'pages/FormPage', 'pages/ListPage'];
  const browse = LENDING.spec.features[0];
  assert.deepEqual(pointStep({ feature: 'browse', point: browse.points[0], pages: [], libraryPages: libs, pageAt: ['/'], points: browse.points }),
    { tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature: 'browse', name: 'BrowsePage' } });
  assert.equal(pointStep({ feature: 'x', point: { id: 'X-1', text: 'A "Save" button keeps it.' }, pages: [], libraryPages: libs }), null);
  assert.equal(pointStep({ feature: 'browse', point: browse.points[0], pages: [], libraryPages: ['pages/DetailPage'], pageAt: ['/'], points: browse.points }), null, 'no ListPage in the library: no guess');
});

test('the shop recipes are data (examples/*.json), and the ecommerce seed lands the same steps and files as before #933', async () => {
  assert.deepEqual(RECIPES.map((r) => [r.block, r.kind, r.needs ?? null]), [['cart', 'selection', null], ['checkout', 'submit', 'cart']]);
  const code = ['atomSteps.mjs', 'specSteps.mjs', 'pageShape.mjs'].map((n) => fs.readFileSync(path.join(REPO, 'packages/engine/line/seed', n), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n')).join('\n');
  assert.doesNotMatch(code, /\b(?:CART|CHK|CAT|PROD)-\d|\bcart\b|\bcheckout\b|\bshipping\b/i, 'no point id or shop word in the seed code');

  const { parent, root, done } = starter(SHOP);
  try {
    const cli = createPlanCli({ project: root, log: path.join(parent, 'logs', 'calls.jsonl'), builder: 'test', spec: SHOP.specFile, shadowJev: false });
    const out = await cli.run('seed');
    assert.equal(out.ok, true, out.sentence);
    // Captured on private/work/2026-09-23 (3184fe0c) before the change.
    assert.deepEqual(out.steps.map((s) => [s.tool, s.args.atom ?? s.args.file ?? s.args.slot ?? (s.args.libraryId ? `${s.args.feature}/${s.args.name} ${s.args.libraryId}` : s.args.name ?? `${s.args.route} ${s.args.page}`)]), [
      ['line.setCode', 'features/catalog/spec.md'], ['line.baseOn', 'catalog/CatalogPage pages/ListPage'], ['line.addRoute', '/ features/catalog/pages/CatalogPage.tsx'],
      ['line.createFeature', 'product'], ['line.baseOn', 'product/ProductPage pages/DetailPage'], ['line.addRoute', '/products/:id features/product/pages/ProductPage.tsx'],
      ['line.createFeature', 'cart'], ['line.baseOn', 'cart/CartPage pages/ListPage'], ['line.addRoute', '/cart features/cart/pages/CartPage.tsx'],
      ['line.createFeature', 'checkout'], ['line.baseOn', 'checkout/CheckoutPage pages/FormPage'], ['line.addRoute', '/checkout features/checkout/pages/CheckoutPage.tsx'],
      ['line.useAtom', 'filter-sort'], ['line.setCode', 'features/catalog/usecases/filterProducts.ts'], ['line.setCode', 'features/catalog/pages/CatalogPage.tsx'],
      ['line.setCode', 'library/services/cart.ts'], ['line.setCode', 'library/usecases/useCart.ts'], ['line.setCode', 'library/components/CartLink.tsx'],
      ['line.setLayoutSlot', 'nav'], ['line.setCode', 'library/components/AddToCart.tsx'], ['line.setCode', 'features/product/pages/ProductPage.tsx'],
      ['line.setCode', 'features/cart/pages/CartPage.tsx'], ['line.useAtom', 'validated-submit'], ['line.setCode', 'features/checkout/services/orders.ts'],
      ['line.setCode', 'features/checkout/usecases/placeOrder.ts'], ['line.setCode', 'features/checkout/pages/CheckoutPage.tsx'],
      ['line.baseOn', 'checkout/ConfirmationPage pages/DetailPage'], ['line.addRoute', '/order/confirmation features/checkout/pages/ConfirmationPage.tsx'],
      ['line.setCode', 'features/checkout/pages/ConfirmationPage.tsx'],
    ]);
    assert.deepEqual(out.open, []);
    // Every file the seed wrote (not Line's own logs, not the shipped atoms) is byte for byte what it wrote before.
    const written = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); if (e.isDirectory()) walk(a); else written.push(path.relative(root, a).split(path.sep).join('/')); } };
    walk(root);
    const changed = written.filter((k) => !/^(line|library\/atoms)\//.test(k)).filter((k) => { try { return fs.readFileSync(path.join(SHOP.dir, 'starter', k), 'utf8') !== fs.readFileSync(path.join(root, k), 'utf8'); } catch { return true; } }).sort();
    const h = crypto.createHash('sha256');
    for (const k of changed) h.update(`${k}\0${fs.readFileSync(path.join(root, k), 'utf8')}\0`);
    assert.equal(changed.length, 22);
    assert.equal(h.digest('hex'), '7d19377ec02dce099fec4716d4f36f09b343a0416c79e64987108f6dcbeeb02c');
  } finally { done(); }
});
