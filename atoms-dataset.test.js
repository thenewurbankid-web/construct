// Tests for the corpus part of the English -> atoms set (bench/atoms/dataset.js): the
// shape of one record and the keep rules. The runtime is a hand-written stand-in, as in
// atoms-checked.test.js, so these do not depend on the atom runtime's repository.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { compileCatalog } = require('./atoms-catalog');
const { createCheckedConverter } = require('./bench/atoms/checked');
const { recordFor, signatureOf, programOf } = require('./bench/atoms/dataset');

const BUNDLE = `globalThis.__smith = {
  times: (a, b) => a * b,
  equals: (a, b) => a === b,
  when: (c, a, b) => (c ? a() : b ? b() : undefined),
};`;
const catalog = compileCatalog([
  { atom: 'times', js: ['a * b'], params: ['a', 'b'] },
  { atom: 'equals', js: ['a === b'], params: ['a', 'b'] },
  { atom: 'when', js: ['c ? a : b'], params: ['condition', 'then', 'otherwise?'] },
]);

describe('corpus records', () => {
  let converter;
  before(async () => { converter = await createCheckedConverter({ compiled: catalog, bundle: BUNDLE }); });
  after(() => converter.dispose());
  const origin = { repo: 'fixtures', file: 'fixture.ts', name: 'f' };
  const build = (code, kind = 'function', opts = {}) => recordFor({ code, kind }, { converter, runs: 10, runtime: 'abc1234', origin, ...opts });

  test('a checked function becomes one record in the shape DESIGN.md gives', () => {
    const { record } = build("function next(state: string): string {\n  if (state === 'cart') return 'paying';\n  return 'done';\n}");
    assert.deepEqual(Object.keys(record), ['id', 'code', 'english', 'signature', 'program', 'atoms', 'source', 'origin', 'englishKind', 'check', 'runtime']);
    assert.match(record.id, /^[0-9a-f]{40}$/);
    assert.equal(record.english, "next using state: if state equals 'cart', return 'paying'; then return 'done'.");
    assert.equal(record.code, "function next(state: string): string {\n  if (state === 'cart') return 'paying';\n  return 'done';\n}");
    assert.equal(record.signature, 'function next(state: string): string');
    assert.equal(record.program, "return when(equals(state, 'cart'), () => 'paying', () => 'done');");
    assert.deepEqual(record.atoms, ['equals', 'when']);
    assert.equal(record.source, 'corpus');
    assert.deepEqual(record.origin, origin);
    assert.equal(record.englishKind, 'mechanical');
    assert.deepEqual(record.check, { status: 'same', runs: 10, exercised: 10 });
    assert.equal(record.runtime, 'abc1234');
  });

  test('a method keeps its header as written and its body without braces', () => {
    const { record } = build('area(w: number, h: number) {\n    const a = w * h;\n    return a;\n  }', 'method');
    assert.equal(record.signature, 'area(w: number, h: number)');
    assert.equal(record.program, 'const a = times(w, h);\nreturn a;');
    assert.match(record.english, /^area using w and h: /);
  });

  test('the same function gives the same record', () => {
    const code = 'function area(w: number, h: number) { return w * h; }';
    assert.deepEqual(build(code), build(code));
  });

  test('a function with no rewrite is dropped', () => {
    assert.equal(build('function id(x: number) { return x; }').dropped, 'no rewrite');
  });

  test('a function that throws on most runs is dropped', () => {
    const out = build('function f(x: number) { if (x !== 1) throw new Error("no"); return x * 2; }');
    assert.equal(out.dropped, 'few runs exercised');
  });

  test('untranslated syntax drops a function unless it is allowed', () => {
    const code = 'function f(x: number) { return typeof x + (x * 2); }';
    assert.ok(build('function f(x: number, g?: () => number) { return g?.() * 2; }').record, 'optional calls are allowed by design');
    assert.equal(build(code).dropped, 'untranslated');
    assert.ok(build(code, 'function', { allowUntranslated: ['UnaryExpression', 'BinaryExpression'] }).record);
  });

  test('a function named like an atom it uses is dropped, not written with the renamed call', () => {
    assert.equal(build('function times(a: number, b: number) { return a * b; }').dropped, 'atom renamed');
  });
});

// `trimmed` is wrong on purpose (it keeps the trailing spaces); compared with itself, the
// function around it hides that, so only running the form on its own shows it
describe('atom forms run on their own', () => {
  let converter;
  before(async () => {
    converter = await createCheckedConverter({
      compiled: compileCatalog([
        { atom: 'equals', js: ['a === b'], params: ['a', 'b'] },
        { atom: 'trimmed', js: ['text.trim()'], params: ['text'], firstKinds: ['string'] },
      ]),
      bundle: 'globalThis.__smith = { equals: (a, b) => a === b, trimmed: (text) => text.trimStart() };',
    });
  });
  after(() => converter.dispose());
  const build = (code) => recordFor({ code, kind: 'function' }, { converter, runs: 20, runtime: 'abc1234' });

  test('a wrong atom hidden by the function around it drops the function', () => {
    const code = 'function tidy(s: string): boolean { return s.trim() === s.trim(); }';
    assert.equal(converter.convert(code, { runs: 20 }).check.status, 'same', 'the whole function hides it');
    const out = build(code);
    assert.equal(out.dropped, 'fails alone');
    assert.match(out.detail, /^trimmed \(atom\) on /);
  });

  test('a right atom passes on its own', () => {
    assert.ok(build('function same(a: number, b: number): boolean { return a === b; }').record);
    assert.equal(converter.alone('equals', converter.convert('function f(a: number, b: number) { return a === b; }').sites[0].form).status, 'same');
  });
});

test('signatureOf and programOf read exported declarations', () => {
  const code = 'export function f(a: number): number {\n  return a;\n}';
  assert.equal(signatureOf(code, 'function'), 'function f(a: number): number');
  assert.equal(programOf(code, 'function'), 'return a;');
});
