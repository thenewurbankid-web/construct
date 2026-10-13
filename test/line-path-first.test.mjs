// #921 path-first proof: the stub check, the locked-signature fill, first-failing-example feedback, the examples (pass
// with the reference body, fail with an empty one), the static path check, purity, the visual diff, and each point's
// whole path end to end. Tests that need tsc or a React render use the bench starter's node_modules and skip without.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { stubProblems, replaceBody, placeholderBody, stubParts } from '../packages/engine/line/path/stubs.mjs';
import { logicExamples, domExamples, edgeProblems, checkPath, readPath, unitOf, bottomUp, visualDiff } from '../packages/engine/line/path/check.mjs';
import { fill, openStubs, failureText } from '../packages/engine/line/path/fill.mjs';
import { classifyUnit } from '../packages/engine/line/logicVerify/purity.mjs';
import { installPath, REFERENCE, derive, buildPath } from '../bench/ecommerce/driver/path-points.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STARTER = path.join(here, '../bench/ecommerce/starter');
const SPEC = fs.readFileSync(path.join(here, '../bench/ecommerce/SPEC.md'), 'utf8');
const PRODUCTS = JSON.parse(fs.readFileSync(path.join(STARTER, 'library/fixtures/products.json'), 'utf8'));
const MODULES = path.join(STARTER, 'node_modules');
const HAS_MODULES = fs.existsSync(path.join(MODULES, 'react-dom')) && fs.existsSync(path.join(MODULES, 'typescript'));
const needModules = HAS_MODULES ? {} : { skip: 'the bench starter has no node_modules (install it, or link one, to run tsc and the renders)' };

/** A copy of the bench starter with the path installed (`bodies` fills stubs at once). */
function project(bodies = {}) {
  const root = makeTempDir('path-first-');
  fs.cpSync(STARTER, root, { recursive: true, filter: (src) => !/[\\/](node_modules|\.next)([\\/]|$)/.test(src) });
  if (HAS_MODULES) fs.symlinkSync(fs.realpathSync(MODULES), path.join(root, 'node_modules'));
  installPath(root, { specText: SPEC, bodies });
  return root;
}
const withBody = (root, id, body) => {
  const u = unitOf(readPath(root), id);
  const f = path.join(root, u.file);
  const r = replaceBody(fs.readFileSync(f, 'utf8'), u.fn, body);
  assert.ok(r.ok, r.sentence);
  fs.writeFileSync(f, r.source);
  return u;
};

test('derivation: the examples come from SPEC.md and the fixture, by small functions', () => {
  assert.deepEqual(derive.categoryList(SPEC), ['All', 'Clothing', 'Home', 'Electronics']);
  assert.deepEqual(derive.categoryCounts(SPEC), { each: 4, all: 12 });
  assert.equal(derive.cartLabel(SPEC).label(3), 'Cart (3)');
  assert.deepEqual(derive.addToCart(SPEC), { field: 'Quantity', defaultQty: 1, button: 'Add to cart', status: 'Added to cart' });
  assert.throws(() => derive.rowsOf(SPEC, PRODUCTS.slice(1), 'Clothing'), /SPEC\.md CAT-2 says 4/);
  const p = buildPath(SPEC, PRODUCTS);
  assert.ok(p.units.filter((u) => u.kind === 'stub').every((u) => u.examples.length && u.examples.every((e) => e.derivedBy)), 'every example says how it was derived');
  assert.ok(!JSON.stringify(p).includes('acceptance/'), 'nothing comes from the held-out acceptance specs');
  assert.deepEqual(bottomUp(p).map((u) => u.layer), ['domain', 'domain', 'domain', 'domain', 'domain', 'service', 'service', 'service', 'component', 'component', 'component']);
});

test('stub check: open placeholder and unused inputs; a filled body is clean; a non-void body must return', () => {
  const src = `export function f({ a, b }: { a: number; b: number }): number ${placeholderBody('x.f')}\nexport function g({ s }: { s: string[] }): void { s.push('k'); }\n`;
  assert.deepEqual(stubProblems(src, 'f').map((p) => p.code), ['OPEN', 'UNUSED_INPUT', 'UNUSED_INPUT']);
  assert.deepEqual(stubProblems(replaceBody(src, 'f', 'return a + b;').source, 'f'), []);
  assert.deepEqual(stubProblems(replaceBody(src, 'f', 'return a * 2;').source, 'f').map((p) => p.sentence), ['The input b is never used in the body.']);
  assert.deepEqual(stubProblems(replaceBody(src, 'f', 'const c = a + b; void c;').source, 'f').map((p) => p.code), ['NO_RETURN']);
  assert.deepEqual(stubProblems(src, 'g'), [], 'a void function needs no return');
  assert.deepEqual(stubProblems(src, 'nope').map((p) => p.code), ['NO_STUB']);
});

test('fill: the signature and imports are locked', () => {
  const src = `import { x } from './x';\nexport function f({ a }: { a: number }): number ${placeholderBody('x.f')}\n`;
  const changed = replaceBody(src, 'f', 'export function f({ a, b }: { a: number; b: number }): number { return a + b; }');
  assert.equal(changed.ok, false);
  assert.equal(changed.code, 'SIGNATURE_CHANGED');
  assert.match(changed.sentence, /keep exactly `export function f\(\{ a \}: \{ a: number \}\): number`/);
  assert.equal(replaceBody(src, 'f', 'import { y } from "./y";\nreturn a;').code, 'IMPORTS_LOCKED');
  const same = replaceBody(src, 'f', 'export function f({ a }: { a: number }): number {\n  return a + 1;\n}');
  assert.ok(same.ok);
  assert.equal(stubParts(same.source, 'f').body, '{\n  return a + 1;\n}');
  assert.equal(replaceBody(src, 'f', 'return (a;').code, 'BAD_BODY');
});

test('examples: a logic stub passes with its reference body and fails with an empty one (first failing example back)', async () => {
  const root = project();
  const p = readPath(root);
  for (const id of ['catalog.domain.filterByCategory', 'cart.service.saveCart', 'cart.service.loadCart', 'cart.domain.cartLinkLabel']) {
    const u = withBody(root, id, REFERENCE[id]);
    assert.equal((await logicExamples(root, u)).failure, null, `${id} passes with the reference body`);
  }
  const u = withBody(root, 'catalog.domain.filterByCategory', 'return [];');
  const r = await logicExamples(root, unitOf(p, u.id));
  assert.equal(r.failure.layer, 'examples');
  assert.equal(r.failure.example, 'filter-1');
  assert.equal(r.failure.got, '[]');
  assert.match(r.failure.expected, /linen-shirt/);
  const text = failureText(r.failure);
  assert.match(text, /Example filter-1:\n {2}input: \{ products: <the 12 fixture products>, category: "All" \}\n {2}expected: the products with ids/);
  const save = withBody(root, 'cart.service.saveCart', "storage.write('basket', JSON.stringify(lines));");
  assert.match((await logicExamples(root, save)).failure.got, /calls \[\["write","basket"/, 'a contract mock records the calls');
  const empty = withBody(root, 'cart.domain.itemCount', '{}');
  assert.match((await logicExamples(root, empty)).failure.got, /null|undefined/);
});

test('dry run and purity: a domain stub that reaches localStorage is flagged by classifyUnit and by the recording fakes', async () => {
  const root = project();
  const u = withBody(root, 'cart.domain.itemCount', "localStorage.setItem('n', String(lines.length));\nreturn lines.reduce((n, l) => n + l.quantity, 0);");
  const c = await classifyUnit({ root, file: u.file, fn: u.fn });
  assert.equal(c.purity, 'impure');
  const r = await logicExamples(root, u);
  assert.equal(r.failure.layer, 'dry-run');
  assert.match(r.failure.got, /had an effect: storage\.setItem n/);
});

test('static path check: every edge is imported and used; a dropped call is the first problem', () => {
  const root = project();
  const p = readPath(root);
  assert.deepEqual(edgeProblems(root, p), []);
  const f = path.join(root, 'features/cart/components/CartNav.tsx');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('cartLinkLabel({ count })', '`Cart (${count})`'));
  assert.deepEqual(edgeProblems(root, p).map((e) => [e.from, e.to, e.code]), [['cart.component.CartNav', 'cart.domain.cartLinkLabel', 'UNUSED']]);
});

test('visual diff: passes only when the expected change is there; other changes never fail it', () => {
  const before = [{ label: 'opened', nodes: [] }, { label: 'chose Home', nodes: [] }];
  const links = (n) => Array.from({ length: n }, (_, i) => ({ role: 'link', name: `P${i}` }));
  const after = [{ label: 'opened', nodes: [{ role: 'combobox', name: 'Category' }, { role: 'heading', name: 'Products' }, ...links(12)] }, { label: 'chose Home', nodes: [{ role: 'combobox', name: 'Category' }, ...links(4)] }];
  const expect = [{ appears: { state: 0, role: 'combobox', name: 'Category' } }, { count: { state: 1, role: 'link', to: 4 } }];
  assert.equal(visualDiff(before, after, expect).ok, true);
  const noNarrow = visualDiff(before, [after[0], { label: 'chose Home', nodes: [{ role: 'combobox', name: 'Category' }, ...links(12)] }], expect);
  assert.deepEqual(noNarrow.missing, ['in "chose Home": 4 links (before 0, after 12)']);
  assert.equal(visualDiff(after, after, expect).ok, false, 'no change is not the expected change');
});

test('render examples: a UI stub passes with the reference body, fails with the step and what was found', needModules, async () => {
  const root = project();
  const u = withBody(root, 'cart.component.CartLink', REFERENCE['cart.component.CartLink']);
  assert.equal((await domExamples(root, u)).failure, null);
  const bad = withBody(root, 'cart.component.CartLink', 'return <span>{label}</span>;');
  const r = await domExamples(root, bad);
  assert.equal(r.failure.example, 'link-1');
  assert.equal(r.failure.expected, 'a link named "Cart (3)"');
  assert.equal(r.failure.got, 'links: []');
  const add = withBody(root, 'product.component.AddToCart', REFERENCE['product.component.AddToCart']);
  assert.equal((await domExamples(root, add)).failure, null);
});

test('fill: refuses a signature change, returns the tsc error at its line or the first failing example, then passes', needModules, async () => {
  const root = project();
  const id = 'cart.domain.cartLinkLabel';
  const changed = await fill({ root, stubId: id, body: 'export function cartLinkLabelBody({ count, extra }: { count: number; extra: string }): string { return extra + count; }' });
  assert.equal(changed.code, 'SIGNATURE_CHANGED');
  const typed = await fill({ root, stubId: id, body: 'return count;' });
  assert.equal(typed.pass, false);
  assert.equal(typed.failure.layer, 'tsc');
  assert.match(typed.failure.sentence, /features\/cart\/domain\/cartLinkLabel\.ts:\d+:\d+ TS2322/);
  assert.equal(typed.failure.code, 'return count;');
  const wrong = await fill({ root, stubId: id, body: 'return `Cart: ${count}`;' });
  assert.match(wrong.sentence, /Example label-1:\n {2}input: \{"count":3\}\n {2}expected: "Cart \(3\)"\n {2}got: "Cart: 3"/);
  const ok = await fill({ root, stubId: id, body: REFERENCE[id] });
  assert.equal(ok.pass, true, ok.sentence);
  assert.equal(ok.visual?.outcome ?? 'pending', 'pending');
  assert.ok(!openStubs(root).some((u) => u.id === id));
  const log = fs.readFileSync(path.join(root, 'line/path/fills.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.map((f) => [f.n, f.pass, f.refused ?? f.failure?.layer ?? null]), [[1, false, 'SIGNATURE_CHANGED'], [2, false, 'tsc'], [3, false, 'examples'], [4, true, null]]);
  assert.equal(log[3].visual.outcome, 'pending', 'the page cannot show the change while the point has open stubs');
});

test('whole path: each point dry-runs green end to end with the reference bodies; the last fill sees the expected visual change', needModules, async () => {
  const root = project(REFERENCE);
  for (const point of ['CAT-2', 'CART-1']) {
    const r = await checkPath(root, point);
    assert.equal(r.green, true, `${point}: ${JSON.stringify(r.failure)}`);
  }
});

/** A project whose CART-1 stubs all passed before (reference bodies, logged passes) except `last`, still a placeholder. */
function cartBeforeLastFill(last) {
  const { [last]: _open, ...rest } = REFERENCE;
  const root = project(rest);
  const log = Object.keys(rest).map((stubId) => JSON.stringify({ stubId, n: 1, pass: true })).join('\n');
  fs.writeFileSync(path.join(root, 'line/path/fills.jsonl'), `${log}\n`);
  return root;
}

test('visual diff in the fill verdict: the last CART-1 fill shows "Cart (0)" then "Cart (2)" on the page', needModules, async () => {
  const root = cartBeforeLastFill('product.component.AddToCart');
  const r = await fill({ root, stubId: 'product.component.AddToCart', body: REFERENCE['product.component.AddToCart'] });
  assert.equal(r.pass, true, r.sentence);
  assert.equal(r.next, null);
  const log = fs.readFileSync(path.join(root, 'line/path/fills.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(log.at(-1).visual.outcome, 'expected-change');
});

test('visual diff catches a wiring fault no stub example sees: the provider drops the added line', needModules, async () => {
  const root = cartBeforeLastFill('product.component.AddToCart');
  const f = path.join(root, 'features/cart/hooks/cartProvider.ts');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('setLines((ls) => addLine({ lines: ls, id, quantity }))', 'setLines((ls) => { void addLine({ lines: ls, id, quantity }); return ls; })'));
  const r = await fill({ root, stubId: 'product.component.AddToCart', body: REFERENCE['product.component.AddToCart'] });
  assert.equal(r.pass, false);
  assert.equal(r.failure.layer, 'visual');
  assert.match(r.failure.sentence, /in "added 2": a link "Cart \(2\)" does not appear/);
  const e2e = await checkPath(root, 'CART-1');
  assert.equal(e2e.green, false);
  assert.equal(e2e.failure.layer, 'e2e', 'every stub passes its own examples: the fault is in the wiring');
});
