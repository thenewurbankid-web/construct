// Expressions (System 1 groundwork): the JSON expression language (contract.mjs exprProblem/assertExpr, the JSON
// Schema), evaluate's plain-English sentences (expr.mjs), the facts snapshot and its mock (facts.mjs, mockFacts.mjs),
// the delexicalized structure hashes (structure.mjs), and a property test: evaluate never throws on a valid expression.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { exprProblem, assertExpr, assertExprEvaluation, assertLineFacts, EXPR_OPS, EXPR_JSON_SCHEMA, EXPR_LIMITS } from '../packages/engine/line/contract.mjs';
import { evaluate } from '../packages/engine/line/expr.mjs';
import { mockFacts } from '../packages/engine/line/mockFacts.mjs';
import { buildFacts, summarizeFacts, factsHash } from '../packages/engine/line/facts.mjs';
import { structureOf } from '../packages/engine/line/structure.mjs';
import { createMockLineOps } from '../packages/engine/line/mock.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/line-sample');
const F = mockFacts();
const ok = (e, facts = F) => { const r = evaluate(facts, e); assertExprEvaluation(r); return r.ok; };
const says = (e, facts = F) => { const r = evaluate(facts, e); assertExprEvaluation(r); assert.equal(r.ok, false, `expected ${JSON.stringify(e)} to fail`); return r.failed.map((f) => f.sentence); };
const P = (...segs) => ({ path: segs });
const BUTTON = 'features/orders/components/OrderButton.tsx';
const BADGE = 'features/orders/components/StatusBadge.tsx';

test('contract: the mock facts fit LineFacts; the schema lists every operator', () => {
  assertLineFacts(F);
  assert.deepEqual(Object.keys(EXPR_JSON_SCHEMA.oneOf[1].properties).sort(), [...EXPR_OPS].sort());
  assert.ok(F.files[BUTTON] && F.library['components/Button'] && F.features.orders.items.length > 0);
});

test('literals and paths: a literal is itself, a path reads the facts, a missing path is missing', () => {
  assert.equal(ok(true), true); assert.equal(ok(false), false); assert.equal(ok({ lit: [1] }), true); assert.equal(ok(null), false);
  assert.equal(ok({ exists: P('files', BUTTON) }), true);
  assert.equal(ok({ eq: [P('library', 'components/Button', 'kind'), 'components'] }), true);
  assert.equal(ok({ eq: [P('features', 'orders', 'items', 0, 'kind'), { lit: F.features.orders.items[0].kind }] }), true, 'a list position is a whole number');
  assert.equal(ok({ exists: P('files', 'nope.tsx') }), false);
});

test('comparisons: eq, ne, lt, le, gt, ge (numbers and texts; mixed types never order)', () => {
  const n = { count: P('features') };
  const k = Object.keys(F.features).length;
  assert.equal(ok({ eq: [n, k] }), true); assert.equal(ok({ ne: [n, k] }), false);
  assert.equal(ok({ lt: [n, k + 1] }), true); assert.equal(ok({ le: [n, k] }), true);
  assert.equal(ok({ gt: [n, k] }), false); assert.equal(ok({ ge: [n, k] }), true);
  assert.equal(ok({ lt: ['a', 'b'] }), true); assert.equal(ok({ lt: [1, 'b'] }), false);
  assert.equal(ok({ eq: [{ lit: { a: [1, 2] } }, { lit: { a: [1, 2] } }] }), true, 'eq compares JSON deeply');
});

test('logic: and, or, not; exists; count of lists, texts and objects', () => {
  assert.equal(ok({ and: [true, { not: false }] }), true); assert.equal(ok({ and: [true, false] }), false);
  assert.equal(ok({ or: [false, true] }), true); assert.equal(ok({ or: [false, false] }), false);
  assert.equal(ok({ eq: [{ count: 'abc' }, 3] }), true); assert.equal(ok({ eq: [{ count: { lit: { a: 1, b: 2 } } }, 2] }), true);
  assert.equal(ok({ eq: [{ count: P('nope') }, 0] }), true, 'a missing value counts 0');
});

test('every, some and in: over lists, with item paths; in for lists, texts and object fields', () => {
  const items = P('features', 'orders', 'items');
  assert.equal(ok({ some: [items, { eq: [{ item: ['name'] }, 'OrderButton'] }] }), true);
  assert.equal(ok({ every: [items, { eq: [{ item: ['name'] }, 'OrderButton'] }] }), false);
  assert.equal(ok({ every: [items, { exists: { item: ['kind'] } }] }), true);
  assert.equal(ok({ some: [P('nope'), true] }), false, 'some over a missing list is false');
  assert.equal(ok({ every: [P('nope'), true] }), false, 'every over a missing list proves nothing');
  assert.equal(ok({ in: ['orders', P('features')] }), true, 'in an object: a field name');
  assert.equal(ok({ in: ['b', { lit: ['a', 'b'] }] }), true); assert.equal(ok({ in: ['ord', 'orders'] }), true);
  assert.equal(ok({ every: [{ lit: [[1], [1, 2]] }, { some: [{ item: [] }, { eq: [{ item: [] }, 1] }] }] }), true, 'item refers to the nearest every/some');
});

test('bad expressions are refused in one sentence, and evaluate says so instead of throwing', () => {
  const cases = [
    [{ foo: 1 }, /"foo" is not an operator/], [{ eq: [1] }, /takes exactly two/], [{ and: [] }, /at least one/],
    [{ eq: [1, 2], ne: [1, 2] }, /exactly one operator, not eq, ne/], [[1, 2], /bare list/], [{ item: ['x'] }, /only means something inside every or some/],
    [{ path: [] }, /at least one part/], [{ path: 'files' }, /takes a list of names/], [{ path: [-1] }, /whole number from 0/],
    [{ exists: true }, /exists takes a path/], [Number.NaN, /finite/], [() => 1, /function is not an expression/],
    [{ lit: new Date() }, /plain JSON/], ['x'.repeat(EXPR_LIMITS.string + 1), /at most/],
  ];
  for (const [e, re] of cases) {
    const why = exprProblem(e);
    assert.match(String(why), re, JSON.stringify(String(e)));
    assert.match(why, /^\S[^\n]*[.]$/, 'one sentence');
    assert.throws(() => assertExpr(e), (err) => err.message === why);
    const r = evaluate(F, e);
    assert.equal(r.ok, false); assert.equal(r.failed.length, 1); assert.match(r.failed[0].sentence, /^This expression cannot be checked: /);
  }
  let deep = true; for (let i = 0; i <= EXPR_LIMITS.depth; i += 1) deep = { not: deep };
  assert.match(String(exprProblem(deep)), /nests deeper/);
});

test('no code execution: code strings are just text, and a path cannot reach a prototype or a function', () => {
  globalThis.__lineExprRan = false;
  const code = 'globalThis.__lineExprRan = true';
  assert.equal(ok({ eq: [code, code] }), true);
  assert.equal(ok({ exists: P('constructor') }), false);
  assert.equal(ok({ exists: P('files', '__proto__') }), false);
  assert.equal(ok({ exists: P('files', 'constructor', 'constructor') }), false);
  assert.equal(ok({ in: ['toString', P('files')] }), false, 'in sees only own fields');
  assert.equal(ok({ lit: { toString: code } }), true);
  assert.equal(globalThis.__lineExprRan, false);
  assert.match(String(exprProblem({ lit: { a: () => 1 } })), /plain JSON/, 'a function inside a literal is refused');
  assert.ok(exprProblem(JSON.parse('{"__proto__": {"x": 1}}')), 'a __proto__ key is not an operator');
});

test('sentences: each failed part is one plain-English sentence that says what is actually so', () => {
  assert.deepEqual(says({ exists: P('files', BADGE) }), [`${BADGE} does not exist yet.`]);
  assert.deepEqual(says({ not: { exists: P('files', BUTTON) } }), [`${BUTTON} already exists.`]);
  assert.deepEqual(says({ eq: [P('library', 'components/Button', 'level'), 'molecule'] }), ['The level of library item components/Button is "atom", not "molecule".']);
  assert.deepEqual(says({ eq: [{ count: P('findingsNew') }, 0] }, { ...F, findingsNew: [{ key: 'k', rule: 'R', severity: 'error', file: 'a' }] }), ['The number of the new problems is 1, not 0.']);
  assert.deepEqual(says({ some: [P('features', 'orders', 'items'), { eq: [{ item: ['name'] }, 'StatusBadge'] }] }), ['Nothing in the items of feature orders has name "StatusBadge".']);
  assert.deepEqual(says({ and: [{ exists: P('files', BADGE) }, { exists: P('library', 'components/Badge') }] }), [`${BADGE} does not exist yet.`, 'Library item components/Badge does not exist yet.'], 'and: every failing part');
  assert.deepEqual(says({ or: [{ exists: P('files', BADGE) }, { eq: [1, 2] }] }), [`None of these holds: ${BADGE} exists; 1 2.`]);
  assert.match(says({ every: [P('features', 'orders', 'items'), { eq: [{ item: ['kind'] }, 'pages'] }] })[0], /^\d+ of \d+ in the items of feature orders fails?(; the first)?: the kind of OrderButton is "components", not "pages"\.$/);
  assert.deepEqual(says({ eq: [P('structure', 'features', 'orders', 'hash'), 'sha256:0000000000000000'] }), [`The structure hash of feature orders is "${F.structure.features.orders.hash}", not "sha256:0000000000000000".`]);
  const r = evaluate(F, { and: [true, { not: { exists: P('files', BUTTON) } }] });
  assert.deepEqual(r.failed.map((f) => f.path), ['and[1].not']);
});

test('facts: built from the real sample project, fixed size, hashed; structure hashes ignore names', () => {
  const facts = buildFacts(SAMPLE);
  const s = summarizeFacts(facts);
  assertLineFacts(s);
  assert.ok(Object.keys(s.files).some((f) => f.startsWith('library/')) && Object.keys(s.files).some((f) => f.startsWith('features/')));
  assert.ok(s.findings.length >= 2, 'the sample\'s planted findings');
  assert.match(factsHash(facts), /^sha256:[0-9a-f]{16}$/);
  assert.equal(factsHash(buildFacts(SAMPLE)), factsHash(facts), 'the same project hashes the same');
  // Renaming every feature, item and library item keeps every structure hash; adding an item changes it.
  const ops = createMockLineOps();
  const renamed = {};
  for (const [p, src] of Object.entries(ops.files())) renamed[p.replace(/orders/g, 'tickets').replace(/OrderButton/g, 'TicketButton')] = src.replace(/orders/g, 'tickets').replace(/OrderButton/g, 'TicketButton');
  const a = structureOf(ops.readLineProject('/m')); const b = structureOf(createMockLineOps({ files: renamed }).readLineProject('/m'));
  assert.equal(a.project, b.project); assert.equal(a.features.orders.hash, b.features.tickets.hash);
  const added = createMockLineOps({ files: { ...ops.files(), 'features/orders/components/Extra.tsx': "// @line-base components/Button\nexport function Extra() { return null; }\n" } });
  const c = structureOf(added.readLineProject('/m'));
  assert.notEqual(c.features.orders.hash, a.features.orders.hash); assert.notEqual(c.project, a.project);
  assert.equal(c.features.orders.layers.pages, a.features.orders.layers.pages, 'other layers keep their hash');
});

test('facts are lazy: a check on the plan alone does not read the project', () => {
  let reads = 0;
  const facts = buildFacts(makeTempDir('facts-lazy-'), { ops: { readLineProject: () => { reads += 1; return { library: [], features: [], findings: [], layout: {} }; } }, plan: { tool: 't', staged: true, applied: true, files: [] } });
  assert.equal(evaluate(facts, { path: ['plan', 'applied'] }).ok, true);
  assert.equal(reads, 0);
  evaluate(facts, { exists: { path: ['library', 'x'] } }); evaluate(facts, { exists: { path: ['features', 'x'] } });
  assert.equal(reads, 1, 'read once, then kept');
});

// --------------------------------------------------------------------------------------------- property test
/** A small seeded random generator (mulberry32), so a failure can be replayed by its seed. */
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function randomJson(r, depth) {
  const k = Math.floor(r() * (depth > 2 ? 5 : 7));
  if (k === 0) return null; if (k === 1) return r() < 0.5; if (k === 2) return Math.floor(r() * 10) - 3; if (k === 3) return ['a', 'b', 'files', ''][Math.floor(r() * 4)];
  if (k === 4) return Math.floor(r() * 3) - 1 > 0 ? 'x.tsx' : 'name';
  if (k === 5) return Array.from({ length: Math.floor(r() * 3) }, () => randomJson(r, depth + 1));
  return Object.fromEntries(Array.from({ length: Math.floor(r() * 3) }, (_, i) => [['a', 'b', 'name', 'x.tsx'][i], randomJson(r, depth + 1)]));
}
function randomExpr(r, depth, inItem) {
  const leaf = depth > 4 || r() < 0.25;
  const seg = () => (r() < 0.7 ? ['a', 'b', 'name', 'x.tsx', 'files'][Math.floor(r() * 5)] : Math.floor(r() * 3));
  const segs = (min) => Array.from({ length: min + Math.floor(r() * 3) }, seg);
  if (leaf) {
    const k = Math.floor(r() * (inItem ? 4 : 3));
    if (k === 0) return randomJson(r, 3) ?? 1; if (k === 1) return { lit: randomJson(r, 2) }; if (k === 2) return { path: segs(1) };
    return { item: segs(0) };
  }
  const ops = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'and', 'or', 'not', 'exists', 'count', 'every', 'some', 'in'];
  const op = ops[Math.floor(r() * ops.length)];
  const sub = (it = inItem) => randomExpr(r, depth + 1, it);
  if (op === 'not' || op === 'count') return { [op]: sub() };
  if (op === 'exists') return { exists: inItem && r() < 0.5 ? { item: segs(0) } : { path: segs(1) } };
  if (op === 'and' || op === 'or') return { [op]: Array.from({ length: 1 + Math.floor(r() * 3) }, () => sub()) };
  if (op === 'every' || op === 'some') return { [op]: [sub(), sub(true)] };
  return { [op]: [sub(), sub()] };
}

test('property: evaluate never throws on a valid expression over random facts, and always answers in the contract', () => {
  const seed = Number(process.env.LINE_EXPR_SEED ?? 20261011);
  const r = rng(seed);
  let valid = 0;
  for (let i = 0; i < 3000; i += 1) {
    const facts = i % 3 === 0 ? F : randomJson(r, 0);
    const e = randomExpr(r, 0, false);
    if (exprProblem(e) !== null) continue;
    valid += 1;
    let res;
    assert.doesNotThrow(() => { res = evaluate(facts, e); }, `seed ${seed}, case ${i}: ${JSON.stringify(e)}`);
    assertExprEvaluation(res);
    assert.equal(evaluate(facts, { not: e }).ok, !res.ok, `not flips the answer (seed ${seed}, case ${i})`);
  }
  assert.ok(valid > 2000, `most generated expressions are valid (${valid})`);
});
