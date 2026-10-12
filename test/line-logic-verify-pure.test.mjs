// Line logic verification step 6 (spec C3): the Z3 translator and proof layer, the fast-check layer over
// ast/pureExportEquivalence seeded with mined literals, and verifyPair's pure path. Synthetic snippets only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToAst } from '../packages/ast/parse.mjs';
import { assertLayerResult, assertUnitVerdict } from '../packages/engine/line/logicVerify/contract.mjs';
import { Unsupported, findFunction, translateFunction } from '../packages/engine/line/logicVerify/z3Translate.mjs';
import { z3Layer, Z3_TIMEOUT_MS } from '../packages/engine/line/logicVerify/z3Prove.mjs';
import { fastCheckLayer, minedSeeds } from '../packages/engine/line/logicVerify/fastCheckLayer.mjs';
import { locateUnitDifference } from '../packages/engine/line/logicVerify/canonical.mjs';
import { verifyPair } from '../packages/engine/line/logicVerify/verifyPair.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'test/fixtures/logic-verify');

const translate = (src, fn = 'f') => { const ast = parseToAst(src); return translateFunction(ast, findFunction(ast, fn)); };
const z3 = async (before, after, opts = {}) => {
  const r = await z3Layer({ beforeSource: before, afterSource: after, fn: 'f', file: 'src/f.ts', ...opts });
  assertLayerResult(r);
  return r;
};

// ---- translator: the supported subset -----------------------------------------------------------------------------

test('z3 translator: params by position, each primitive param a free variable of its sort', () => {
  const t = translate('export function f(age: number, ok: boolean, name: string) { return ok && age >= 18 && name === "x"; }');
  assert.deepEqual(t.vars, [{ name: '$0', sort: 'num', path: [] }, { name: '$1', sort: 'bool', path: [] }, { name: '$2', sort: 'str', path: [] }]);
  assert.equal(t.body.k, 'and');
  assert.equal(t.body.sort, 'bool');
});

test('z3 translator: member reads on typed params (interface, type alias, inline literal, nested) are free variables', () => {
  const src = [
    'interface Addr { zip: string }',
    'type User = { age: number; addr: Addr };',
    'export const f = (u: User, o: { on: boolean }) => o.on ? u.addr.zip === "1" : u.age > 0;',
  ].join('\n');
  assert.deepEqual(translate(src).vars.map((v) => [v.name, v.sort]), [['$0.age', 'num'], ['$0.addr.zip', 'str'], ['$1.on', 'bool']]);
});

test('z3 translator: early returns, else branches and consts become one nested ternary', () => {
  const t = translate('export function f(a: number): string { const lim = 10; if (a > lim) { return "big"; } else if (a < 0) return "neg"; return "ok"; }');
  assert.equal(t.body.k, 'ite');
  assert.equal(t.body.b.k, 'ite');
  assert.deepEqual(t.body.b.b, { k: 'lit', sort: 'str', v: 'ok' });
});

test('z3 translator: arithmetic, unary minus, string concat, ternaries and truthiness tests', () => {
  assert.equal(translate('export const f = (a: number, b: number) => -a * 2 + b / 3 - 1;').body.k, 'arith');
  assert.equal(translate('export const f = (a: string, b: string) => a + b;').body.k, 'concat');
  const t = translate('export const f = (a: number, s: string) => (a ? s : "none");');
  assert.equal(t.body.c.k, 'truthy');
  assert.equal(translate('export const f = (s: string) => !s;').body.a.k, 'truthy');
});

test('z3 translator: anything outside the subset throws Unsupported naming the construct', () => {
  const out = {
    'export const f = (a: string, b: string) => `${a} ${b}`;': /TemplateLiteral/,
    'export const f = (a: string) => a.trim();': /CallExpression/,
    'export const f = (a: number, b: number) => a ?? b;': /\?\?/,
    'export const f = (a: number, b: number) => a && b;': /non-booleans/,
    'export const f = (a: number) => a % 2;': /operator %/,
    'export const f = (a: number, b: string) => a === b;': /between a num and a str/,
    'export function f(a: number) { let x = a; return x; }': /let declaration/,
    'export function f(a: number) { if (a > 1) return true; }': /ends without a return/,
    'export function f(a?: number) { return 1; }': /optional parameter/,
    'export function f(a) { return a; }': /untyped parameter/,
    'export function f(u: { a?: number }) { return 1; }': /optional member a/,
    'export function f(xs: number[]) { return xs.length; }': /TSArrayType/,
    'export function f(a: number) { return Math.abs(a); }': /CallExpression/,
    'export function f(a: number) { console.log(a); return a; }': /ExpressionStatement/,
    'export async function f(a: number) { return a; }': /async/,
  };
  for (const [src, re] of Object.entries(out)) assert.throws(() => translate(src), (e) => e instanceof Unsupported && re.test(e.message), src);
});

// ---- the Z3 layer ----------------------------------------------------------------------------------------------------

test('z3 layer: !(a && b) and !a || !b are proven equal', async () => {
  const r = await z3('export function f(a: boolean, b: boolean) { return !(a && b); }', 'export function f(a: boolean, b: boolean) { return !a || !b; }');
  assert.equal(r.outcome, 'same-behaviour');
});

test('z3 layer: an early return rewritten as a ternary, with a renamed param, is proven equal', async () => {
  const r = await z3(
    'interface U { age: number; name: string }\nexport function f(u: U): string { if (u.age < 0) return "bad"; return u.name === "" ? "anon" : u.name; }',
    'interface U { age: number; name: string }\nexport const f = (user: U): string => (user.age < 0 ? "bad" : user.name ? user.name : "anon");',
  );
  assert.equal(r.outcome, 'same-behaviour');
});

test('z3 layer: a flipped condition is changed, with the counterexample and the operator location', async () => {
  const r = await z3('export function f(age: number) {\n  return age >= 18;\n}', 'export function f(age: number) {\n  return age > 18;\n}');
  assert.equal(r.outcome, 'changed');
  assert.deepEqual(r.input, [18]);
  assert.deepEqual(r.location, { astPath: 'f/FunctionDeclaration.body/BlockStatement.body[0]/ReturnStatement.argument/BinaryExpression.operator', file: 'src/f.ts', line: 2, column: 10 });
});

test('z3 layer: numbers are IEEE doubles, so !(a >= 18) and a < 18 differ at NaN (no false proof over the reals)', async () => {
  const r = await z3('export const f = (a: number) => !(a >= 18);', 'export const f = (a: number) => a < 18;');
  assert.equal(r.outcome, 'changed');
  assert.ok(Number.isNaN(r.input[0]));
});

test('z3 layer: a counterexample on an object param comes back as an object', async () => {
  const r = await z3('export const f = (u: { age: number; vip: boolean }) => u.vip || u.age >= 65;', 'export const f = (u: { age: number; vip: boolean }) => u.vip || u.age > 65;');
  assert.equal(r.outcome, 'changed');
  assert.deepEqual(r.input, [{ age: 65, vip: false }]);
});

test('z3 layer: outside the subset is skipped with the reason, so fast-check decides', async () => {
  const r = await z3('export const f = (a: string) => a.trim();', 'export const f = (a: string) => a.trimEnd().trimStart();');
  assert.equal(r.outcome, 'skipped');
  assert.match(r.reason, /CallExpression is outside the Z3 subset/);
  assert.equal((await z3('export const g = 1;', 'export const g = 2;')).outcome, 'skipped');
});

test('z3 layer: the per-proof timeout gives cant-tell, never same-behaviour', async () => {
  const r = await z3(
    'export const f = (a: number, b: number, c: number) => a * (b * c) === a;',
    'export const f = (a: number, b: number, c: number) => (a * b) * c === a;',
    { timeoutMs: 1 },
  );
  assert.equal(r.outcome, 'cant-tell');
  assert.match(r.reason, /1 ms timeout/);
});

test(`z3 layer: each small proof stays well under the ${Z3_TIMEOUT_MS} ms budget once Z3 is loaded`, async () => {
  await z3('export const f = (a: boolean) => a;', 'export const f = (a: boolean) => !!a;');
  for (const [b, a] of [
    ['export const f = (a: number, b: number) => a > b ? a : b;', 'export const f = (a: number, b: number) => a >= b ? a : b;'],
    ['export const f = (a: number, b: boolean) => b && a > 0 && a < 100;', 'export const f = (a: number, b: boolean) => !(!b || a <= 0 || a >= 100);'],
  ]) {
    const r = await z3(b, a);
    assert.ok(r.ms < 500, `${r.ms} ms`);
  }
});

// ---- the location -----------------------------------------------------------------------------------------------------

test('locateUnitDifference (the one locator, canonical.mjs): a renamed local is not a difference; a changed literal is, at its line and column', () => {
  const at = (before, after) => locateUnitDifference({ source: before, file: 'src/f.ts', fn: 'f' }, { source: after, file: 'src/f.ts', fn: 'f' });
  const before = 'function f(a: number) {\n  const b = a * 2;\n  return b + 1;\n}';
  assert.deepEqual(at(before, 'function f(x: number) {\n  const y = x * 2;\n  return y + 2;\n}'), { astPath: 'f/FunctionDeclaration.body/BlockStatement.body[1]/ReturnStatement.argument/BinaryExpression.right', file: 'src/f.ts', line: 3, column: 14 });
  assert.equal(at(before, 'function f(y: number) {\n  const z = y * 2;\n  return z + 1;\n}'), null);
});

// ---- the fast-check layer -------------------------------------------------------------------------------------------

test('fast-check layer: the same behaviour is same-behaviour (a sample, so tested at best)', () => {
  const r = fastCheckLayer({ beforeSource: 'export function f(a: string, b: string) { return `${a} ${b}`.trim(); }', afterSource: "export function f(a: string, b: string) { return [a, b].join(' ').trim(); }", fn: 'f', file: 'src/f.ts' });
  assertLayerResult(r);
  assert.equal(r.outcome, 'same-behaviour');
});

test('fast-check layer: mined literals seed the runs, so a far-off boundary is found with its input and location', () => {
  const before = 'export function f(n: number) {\n  return n >= 1000003 ? 1 : 0;\n}';
  const after = 'export function f(n: number) {\n  return n > 1000003 ? 1 : 0;\n}';
  const r = fastCheckLayer({ beforeSource: before, afterSource: after, fn: 'f', file: 'src/f.ts', seeds: { byParam: { n: [1000003] }, numbers: [], strings: [] } });
  assertLayerResult(r);
  assert.equal(r.outcome, 'changed');
  assert.deepEqual(r.input, [1000003]);
  assert.equal(r.location.astPath, 'f/FunctionDeclaration.body/BlockStatement.body[0]/ReturnStatement.argument/ConditionalExpression.test/BinaryExpression.operator');
});

test('fast-check layer: an impure or untyped function is skipped with the reason', () => {
  assert.equal(fastCheckLayer({ beforeSource: 'export function f(a: number) { return fetch(a); }', afterSource: 'export function f(a: number) { return fetch(a + 1); }', fn: 'f', file: 'src/f.ts' }).outcome, 'skipped');
  assert.equal(fastCheckLayer({ beforeSource: 'export function f(a) { return a; }', afterSource: 'export function f(a) { return a + 0; }', fn: 'f', file: 'src/f.ts' }).reason, 'unsupported parameter types');
});

test('minedSeeds: the characterizer pools of both sides, keyed by param', () => {
  const s = minedSeeds([path.join(FIX, 'flipped-condition/before'), path.join(FIX, 'flipped-condition/after')], 'src/age.ts');
  assert.deepEqual(s.byParam.age, [18, 19, 17]);
  assert.deepEqual(s.numbers, [18]);
  assert.deepEqual(minedSeeds([path.join(FIX, 'nowhere')], 'src/age.ts'), { byParam: {}, numbers: [], strings: [] });
});

// ---- verifyPair, pure path --------------------------------------------------------------------------------------------

function pair(before, after) {
  const dir = makeTempDir('construct-lv6-');
  for (const [side, src] of [['before', before], ['after', after]]) {
    fs.mkdirSync(path.join(dir, side, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, side, 'src/rule.ts'), src);
  }
  return { beforeRoot: path.join(dir, 'before'), afterRoot: path.join(dir, 'after'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const UNIT = { fingerprint: 'a1f00000000000aa', id: 'src/rule.ts#canShip:export:0', kind: 'export', file: 'src/rule.ts', fn: 'canShip', line: 1 };

test('verifyPair: a Z3 proof proves a closed-set transform; the same proof on a hand edit is only tested', async () => {
  const p = pair('export function canShip(paid: boolean, held: boolean) { return !(held || !paid); }', 'export function canShip(paid: boolean, held: boolean) {\n  const ok = paid && !held;\n  return ok;\n}');
  try {
    const proven = await verifyPair({ ...p, unit: UNIT, transforms: ['extract-expression'], levels: ['L0'] });
    assertUnitVerdict(proven);
    assert.equal(proven.status, 'proven');
    assert.equal(proven.layer, 'z3');
    const hand = await verifyPair({ ...p, unit: UNIT, transforms: null, levels: ['L0'] });
    assert.equal(hand.status, 'tested');
    assert.equal(hand.layer, 'z3');
  } finally { p.cleanup(); }
});

test('verifyPair: no layer decides, so the unit is unverified, never assumed fine', async () => {
  const p = pair('export function canShip(xs: number[]) { return xs.length > 0; }', 'export function canShip(xs: number[]) { return xs.some(() => true); }');
  try {
    const v = await verifyPair({ ...p, unit: UNIT, transforms: null, levels: ['L0'] });
    assertUnitVerdict(v);
    assert.equal(v.status, 'tested', 'fast-check samples arrays, so a same result is tested');
    const q = pair('export function canShip(m: Map<string, number>) { return m.size > 0; }', 'export function canShip(m: Map<string, number>) { return m.size >= 1; }');
    try {
      const u = await verifyPair({ ...q, unit: UNIT, transforms: null, levels: ['L0'] });
      assert.equal(u.status, 'unverified');
    } finally { q.cleanup(); }
  } finally { p.cleanup(); }
});
