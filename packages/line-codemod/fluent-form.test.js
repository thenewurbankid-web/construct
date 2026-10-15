// Unit tests for fluent-form.js (atom call -> fluent sentence). Uses the runtime's real
// catalog.json, so a catalog change that breaks a sentence shows up here.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const parser = require('@babel/parser');
const { toFluent, explainFluent, fluentFor } = require('./fluent-form');
const { loadCatalog } = require('./atoms-catalog');

const CATALOG_PATH = path.resolve(__dirname, '..', 'line-smith', 'src', 'atoms', 'catalog.json');
const RAW = require(CATALOG_PATH);
const fluentOf = (atom) => RAW.atoms.find((a) => a.atom === atom).fluent;

describe('toFluent: catalog atoms round-trip', () => {
  // the call written with the fluent's own argument names gives back the catalog sentence
  const CALLS = {
    equals: 'equals(a, b)',
    lessThan: 'lessThan(a, b)',
    and: 'and(a, () => b)',
    when: 'when(c, () => a, () => b)',
    isText: 'isText(value)',
    hasKey: 'hasKey(obj, key)',
    isA: 'isA(value, Type)',
    hasItem: 'hasItem(xs, x)',
    lowerCase: 'lowerCase(s)',
    replaceEvery: 'replaceEvery(s, p, r)',
    mapEach: 'mapEach(xs, fn)',
    attempt: 'attempt(() => body, (e) => recover, () => cleanup)',
  };
  for (const [atom, call] of Object.entries(CALLS)) {
    test(atom, () => assert.equal(toFluent(call, RAW), fluentOf(atom)));
  }
  test('choose and match are built case by case', () => {
    assert.equal(toFluent('choose([[c1, () => a], [c2, () => b]], () => fallback)', RAW), fluentOf('choose'));
    assert.equal(toFluent("match(value, { k: () => a }, () => fallback)", RAW), 'matches().value(value).on("k").yields(() => a).otherwise(() => fallback)');
  });
});

describe('toFluent: arguments', () => {
  test('params are replaced by the call argument source', () => {
    assert.equal(toFluent('lessThan(price, limit + 1)', RAW), 'checks().if(price).is().less().than(limit + 1)');
    assert.equal(toFluent('replaceFirst(name, "-", " ")', RAW), 'clones().text(name).and().replaces().first("-").with(" ")');
  });
  test('a thunk slot wraps a plain value and keeps a function', () => {
    assert.equal(toFluent('and(ok, ready)', RAW), 'checks().if(ok).and(() => ready)');
    assert.equal(toFluent('and(ok, () => ready)', RAW), 'checks().if(ok).and(() => ready)');
  });
  test('a missing optional argument drops its step', () => {
    assert.equal(toFluent('when(c, () => a)', RAW), 'when(c).yields(() => a)');
    assert.equal(toFluent('attempt(() => run(), (e) => 0)', RAW), 'attempts().to(() => run()).and().recovers().with((e) => 0)');
    assert.equal(toFluent('attempt(() => run(), undefined, () => done())', RAW), 'attempts().to(() => run()).and().cleans().up().with(() => done())');
  });
  test('null when the atom has no fluent, or an argument has no place', () => {
    assert.equal(toFluent('times(a, b)', RAW), null);
    assert.equal(explainFluent('times(a, b)', RAW).reason, 'atom has no fluent');
    assert.equal(toFluent('hasItem(xs, 3, 1)', RAW), null);
    assert.match(explainFluent('hasItem(xs, 3, 1)', RAW).reason, /argument 3/);
    assert.equal(toFluent('equals(...pair)', RAW), null);
    assert.equal(toFluent('notAnAtom(a)', RAW), null);
  });
  test('accepts a Babel CallExpression and a compiled catalog', () => {
    const node = parser.parseExpression('isNothing(user.name)');
    assert.equal(toFluent(node, RAW), 'checks().if(user.name).is().nothing()');
    const compiled = loadCatalog(CATALOG_PATH);
    assert.equal(toFluent('atLeast(n, 2)', compiled), 'checks().if(n).is().at().least(2)');
  });
});

describe('fluentFor', () => {
  const catalog = loadCatalog(CATALOG_PATH);
  test('toAtoms then every atom call becomes a sentence, innermost first', () => {
    const r = fluentFor("function f(x) { return typeof x === 'string' && x.trim().toLowerCase(); }", { catalog });
    assert.match(r.code, /checks\(\)\.if\(checks\(\)\.if\(x\)\.is\(\)\.text\(\)\)\.and\(\(\) => clones\(\)\.text\(clones\(\)\.text\(x\)\.and\(\)\.trims\(\)\)\.and\(\)\.lowercases\(\)\)/);
    assert.equal(r.full, true);
    assert.equal(r.plain, 0);
  });
  test('an atom without a fluent stays a plain call and is reported', () => {
    const r = fluentFor('function f(xs) { return xs.map((v) => v * 2); }', { catalog });
    assert.equal(r.full, false);
    assert.deepEqual(r.reasons, [{ atom: 'times', reason: 'atom has no fluent' }]);
    assert.match(r.code, /clones\(\)\.list\(xs\)\.and\(\)\.maps\(\)\.each\(\)\.with\(v => times\(v, 2\)\)/);
  });
  test('a switch becomes a matches() sentence', () => {
    const r = fluentFor("function f(x) { switch (x) { case 'a': return 1; default: return 3; } }", { catalog });
    assert.match(r.code, /matches\(\)\.value\(x\)\.on\("a"\)\.yields\(\(\) => 1\)\.otherwise\(\(\) => 3\)/);
  });
});
