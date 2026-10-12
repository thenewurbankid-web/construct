// Line logic verification, step 3: the C1 canonicaliser (logicVerify/canonical.mjs), the extraction round-trip
// (logicVerify/roundTrip.mjs) and verifyPair's L0 walk. Edge cases of the canonical form, each with the choice made.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalUnit, canonicalCompare, PINNED, SELF } from '../packages/engine/line/logicVerify/canonical.mjs';
import { roundTripCompare, inBlocks } from '../packages/engine/line/logicVerify/roundTrip.mjs';
import { verifyPair } from '../packages/engine/line/logicVerify/verifyPair.mjs';
import { assertLayerResult } from '../packages/engine/line/logicVerify/contract.mjs';
import { isDecisive } from '../packages/engine/line/logicVerify/escalation.mjs';
import { unitFingerprint } from '../packages/engine/line/logicMap.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const unit = (source, fn = 'f', file = 'src/a.ts') => ({ file, fn, source });
const compare = (before, after, fn = 'f', afterFn = fn, transforms = ['move']) => canonicalCompare(unit(before, fn), unit(after, afterFn), { transforms });
const same = (before, after, fn, afterFn) => compare(before, after, fn, afterFn).outcome === 'same-behaviour';

test('canonical: the form is stable text and its hash is the logic-map fingerprint of it', () => {
  const u = canonicalUnit(unit('export function f(a: number): number {\n  return a + 1;\n}\n'));
  assert.equal(u.text, `function ${SELF}($$0){return $$0+1}`);
  assert.equal(u.hash, unitFingerprint('export', SELF, `esbuild@${PINNED.version}\u0000${u.text}`));
  assert.match(u.hash, /^[0-9a-f]{16}$/);
  assert.equal(canonicalUnit(unit('function g() {}')), null);
});

test('canonical: comments, formatting, quotes and type annotations do not matter', () => {
  assert.ok(same(
    'function f(a: string, n: number): string { /* why */ return a.repeat(n) + "!"; } // trailing',
    "function f(a, n) {\n  // explained\n  return (a as string).repeat(n!) + '!'\n}",
  ));
});

test('canonical: renamed locals, a renamed unit and a recursive call through its name are equal', () => {
  assert.ok(same(
    'function sum(xs) { let total = 0; for (const x of xs) total += x; return xs.length ? total : sum([0]); }',
    'function addAll(items) { let acc = 0; for (const it of items) acc += it; return items.length ? acc : addAll([0]); }',
    'sum', 'addAll',
  ));
  // a shorthand property keeps its key when its value is renamed
  assert.ok(same('function f(id) { return { id }; }', 'function f(key) { return { id: key }; }'));
  assert.ok(!same('function f(id) { return { id }; }', 'function f(key) { return { key }; }'));
});

test('canonical: a renamed free name is a different function, not a rename', () => {
  const r = compare('function f(a) { return check(a); }', 'function f(a) { return verify(a); }');
  assert.equal(r.outcome, 'changed');
  assert.equal(r.location.astPath, 'f/FunctionDeclaration.body/BlockStatement.body[0]/ReturnStatement.argument/CallExpression.callee');
});

test('canonical: renaming is scope-precise (an outer name that a block also declares is not a local)', () => {
  // `x` after the block is the module's x, `y` is the module's y: a name-based renamer would call these equal
  assert.ok(!same('function f() { { let x = 1; use(x); } return x; }', 'function f() { { let y = 1; use(y); } return y; }'));
  assert.ok(same('function f() { { let x = 1; use(x); } return z; }', 'function f() { { let y = 1; use(y); } return z; }'));
});

test('canonical: reordered independent declarations are NOT equal (no effect analysis at L0, the minifier never reorders)', () => {
  const r = compare('function f() { const a = load(); const b = save(); return a + b; }', 'function f() { const b = save(); const a = load(); return a + b; }');
  assert.equal(r.outcome, 'changed');
  assert.equal(r.location.astPath, 'f/FunctionDeclaration.body/BlockStatement.body[0]/VariableDeclaration.declarations[0]/VariableDeclarator.init/CallExpression.callee');
  // even pure literal declarations: proving the swap safe is a later layer's work
  assert.ok(!same('function f() { const a = 1; const b = 2; return a - b; }', 'function f() { const b = 2; const a = 1; return a - b; }'));
});

test('canonical: an arrow function and a function declaration are NOT equal (this, arguments, hoisting, new)', () => {
  const r = compare('function f(a) { return a + 1; }', 'const f = (a) => a + 1;');
  assert.equal(r.outcome, 'changed');
  assert.equal(r.location.astPath, 'f/ArrowFunctionExpression');
  // the same arrow with renamed parameters, or a function expression, are found by the variable's name
  assert.ok(same('const f = (a) => a + 1;', 'export const f = (b: number) => b + 1;'));
  assert.ok(!same('const f = (a) => a + 1;', 'const f = (a) => { return a + 1; };'));
});

test('canonical: methods and hook callbacks are units too', () => {
  assert.ok(same('class A { f(x) { return x * 2; } }', 'class B { f(y: number) { return y * 2; } }'));
  assert.ok(same('const C = () => { const f = useCallback((e) => go(e.id), []); };', 'const C = () => { const f = useCallback((ev) => go(ev.id), []); };'));
});

test('canonical compare: a mismatch carries the exact location, on the before side for a dropped statement', () => {
  const before = 'async function f(o) {\n  await api.post(o);\n  toast.ok("saved");\n  done();\n}\n';
  const dropped = compare(before, 'async function f(o) {\n  await api.post(o);\n  done();\n}\n', 'f', 'f', null);
  assertLayerResult(dropped);
  assert.deepEqual(dropped.location, { astPath: 'f/FunctionDeclaration.body/BlockStatement.body[1]', file: 'src/a.ts', line: 3, column: 3, side: 'before' });
  assert.match(dropped.reason, /not decisive/);
  assert.equal(isDecisive(dropped, null), false);
  const added = compare('function f(a) {\n  return a;\n}', 'function f(a) {\n  log(a);\n  return a;\n}', 'f', 'f', ['move']);
  assert.deepEqual(added.location, { astPath: 'f/FunctionDeclaration.body/BlockStatement.body[0]', file: 'src/a.ts', line: 2, column: 3 });
  assert.equal(isDecisive(added, ['move']), true);
  assert.equal(added.reason, undefined);
});

test('canonical compare: a missing unit is cant-tell, never a pass', () => {
  const r = compare('function f() {}', 'function g() {}');
  assert.equal(r.outcome, 'cant-tell');
  assert.match(r.reason, /f is not in src\/a\.ts after/);
});

// ---- round-trip --------------------------------------------------------------------------------------------------

function tree(files) {
  const root = makeTempDir('lv3-');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}
const ORIGINAL = { 'src/price.ts': 'export function price(qty: number, unit: number) {\n  return qty * unit > 100 ? qty * unit * 0.9 : qty * unit;\n}\n' };

test('round-trip: re-inlining an extracted function gives the original back', (t) => {
  const beforeRoot = tree(ORIGINAL);
  const afterRoot = tree({
    'src/price.ts': "import { gross } from './atoms/gross';\n\nexport function price(qty: number, unit: number) {\n  return gross(qty, unit) > 100 ? gross(qty, unit) * 0.9 : gross(qty, unit);\n}\n",
    'src/atoms/gross.ts': 'export const gross = (q: number, u: number) => q * u;\n',
  });
  t.after(() => { fs.rmSync(beforeRoot, { recursive: true }); fs.rmSync(afterRoot, { recursive: true }); });
  const r = roundTripCompare({ beforeRoot, afterRoot, before: { file: 'src/price.ts', fn: 'price' }, after: { file: 'src/price.ts', fn: 'price' }, transforms: ['extract-function'] });
  assert.equal(r.outcome, 'same-behaviour', r.reason);
  assert.deepEqual(r.inlined, ['src/atoms/gross.ts#gross', 'src/atoms/gross.ts#gross', 'src/atoms/gross.ts#gross']);
});

test('round-trip: an extraction that changed the logic is changed, at the call site', (t) => {
  const beforeRoot = tree(ORIGINAL);
  const afterRoot = tree({
    'src/price.ts': 'export function price(qty: number, unit: number) {\n  return gross(qty, unit) > 100 ? gross(qty, unit) * 0.9 : gross(qty, unit);\n}\nfunction gross(q: number, u: number) {\n  return q + u;\n}\n',
  });
  t.after(() => { fs.rmSync(beforeRoot, { recursive: true }); fs.rmSync(afterRoot, { recursive: true }); });
  const r = roundTripCompare({ beforeRoot, afterRoot, before: { file: 'src/price.ts', fn: 'price' }, after: { file: 'src/price.ts', fn: 'price' }, transforms: ['extract-function'] });
  assert.equal(r.outcome, 'changed');
  assert.equal(r.layer, 'round-trip');
  assert.equal(r.location.file, 'src/price.ts');
  assert.equal(r.location.line, 2);
  assert.match(r.location.astPath, /^price\/FunctionDeclaration\.body\/BlockStatement\.body\[0\]\/ReturnStatement\.argument\/ConditionalExpression\.test\/BinaryExpression\.left\/BinaryExpression\.operator$/);
});

test('round-trip: an argument with effects cannot be substituted, so it answers cant-tell', (t) => {
  const beforeRoot = tree({ 'src/a.ts': 'export function f() { return load() * 2; }\n' });
  const afterRoot = tree({ 'src/a.ts': 'export function f() { return twice(load()); }\nfunction twice(n) { return n * 2; }\n' });
  t.after(() => { fs.rmSync(beforeRoot, { recursive: true }); fs.rmSync(afterRoot, { recursive: true }); });
  const r = roundTripCompare({ beforeRoot, afterRoot, before: { file: 'src/a.ts', fn: 'f' }, after: { file: 'src/a.ts', fn: 'f' } });
  assert.equal(r.outcome, 'cant-tell');
  assert.match(r.reason, /not a plain name or literal/);
});

test('verifyPair: an extracted unit inside a block is proven by the round-trip; outside every block it is not-extracted', async (t) => {
  const beforeRoot = tree(ORIGINAL);
  const afterRoot = tree({
    'src/price.ts': "import { gross } from './atoms/gross';\n\nexport function price(qty: number, unit: number) {\n  return gross(qty, unit) > 100 ? gross(qty, unit) * 0.9 : gross(qty, unit);\n}\n",
    'src/atoms/gross.ts': 'export const gross = (q: number, u: number) => q * u;\n',
  });
  t.after(() => { fs.rmSync(beforeRoot, { recursive: true }); fs.rmSync(afterRoot, { recursive: true }); });
  const ref = { fingerprint: '0123456789abcdef', id: 'src/price.ts#price:export:0', kind: /** @type {const} */ ('export'), file: 'src/price.ts', fn: 'price', line: 3 };
  const blocks = [{ file: 'src/price.ts' }, { file: 'src/atoms/gross.ts', fn: 'gross' }];
  assert.ok(inBlocks(ref, blocks));
  const v = await verifyPair({ beforeRoot, afterRoot, unit: ref, transforms: ['extract-function'], levels: ['L0'], blocks });
  assert.equal(v.status, 'proven');
  assert.equal(v.layer, 'round-trip');
  const out = await verifyPair({ beforeRoot, afterRoot, unit: ref, transforms: ['extract-function'], levels: ['L0'], blocks: [{ file: 'src/atoms/gross.ts' }] });
  assert.equal(out.status, 'not-extracted');
});

test('verifyPair: a hand edit that only L0 has seen stays unverified; a claimed transform that changed text is changed', async (t) => {
  const beforeRoot = tree({ 'src/a.ts': 'export function f(a) {\n  return a >= 18;\n}\n' });
  const afterRoot = tree({ 'src/a.ts': 'export function f(a) {\n  return a > 18;\n}\n' });
  t.after(() => { fs.rmSync(beforeRoot, { recursive: true }); fs.rmSync(afterRoot, { recursive: true }); });
  const ref = { fingerprint: '0123456789abcdef', id: 'src/a.ts#f:export:0', kind: /** @type {const} */ ('export'), file: 'src/a.ts', fn: 'f', line: 1 };
  const hand = await verifyPair({ beforeRoot, afterRoot, unit: ref, transforms: null, levels: ['L0'] });
  assert.equal(hand.status, 'unverified');
  const claimed = await verifyPair({ beforeRoot, afterRoot, unit: ref, transforms: ['rename'], levels: ['L0'] });
  assert.equal(claimed.status, 'changed');
  assert.deepEqual(claimed.location, { astPath: 'f/FunctionDeclaration.body/BlockStatement.body[0]/ReturnStatement.argument/BinaryExpression.operator', file: 'src/a.ts', line: 2, column: 10 });
});
