// Unit tests for fluent-form.js (atom call -> fluent sentence). Uses the runtime's real
// catalog.json, so a catalog change that breaks a sentence shows up here. Every sentence produced
// here also goes through the R1-R9 grammar gate (line-fluent checkGrammar, C5 nextWords).
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const parser = require('@babel/parser');
const { toFluent, explainFluent, fluentFor } = require('./fluent-form');
const { loadCatalog } = require('./atoms-catalog');

const CATALOG_PATH = path.resolve(__dirname, '..', 'line-smith', 'src', 'atoms', 'catalog.json');
const RAW = require(CATALOG_PATH);
const fluentOf = (atom) => RAW.atoms.find((a) => a.atom === atom).fluent;
const GRAMMAR_PATH = path.resolve(__dirname, '..', 'line-fluent', 'gate', 'grammar', 'grammar.mjs');

// every sentence a test produced; the last suite checks them all against the grammar
const produced = [];
const fluent = (call, catalog = RAW) => {
  const s = toFluent(call, catalog);
  if (s) produced.push({ call, sentence: s });
  return s;
};

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
    test(atom, () => assert.equal(fluent(call, RAW), fluentOf(atom)));
  }
  test('choose and match are built case by case', () => {
    assert.equal(fluent('choose([[c1, () => a], [c2, () => b]], () => fallback)', RAW), fluentOf('choose'));
    assert.equal(fluent("match(value, { k: () => a }, () => fallback)", RAW), 'matches().value(value).on("k").yields(() => a).otherwise(() => fallback)');
  });
});

describe('toFluent: arguments', () => {
  test('params are replaced by the call argument source', () => {
    assert.equal(fluent('lessThan(price, limit + 1)', RAW), 'checks().if(price).is().less().than(limit + 1)');
    assert.equal(fluent('replaceFirst(name, "-", " ")', RAW), 'clones().text(name).and().replaces().first("-").with(" ")');
  });
  test('a thunk slot wraps a plain value and keeps a function', () => {
    assert.equal(fluent('and(ok, ready)', RAW), 'checks().if(ok).and(() => ready)');
    assert.equal(fluent('and(ok, () => ready)', RAW), 'checks().if(ok).and(() => ready)');
  });
});

describe('toFluent: explicit refusals (null, reason in explainFluent)', () => {
  const refuses = (call, reason) => {
    assert.equal(toFluent(call, RAW), null, call);
    assert.match(explainFluent(call, RAW).reason, reason, call);
  };
  test('a missing optional argument: the grammar has no shorter sentence', () => {
    refuses('when(c, () => a)', /argument 3 \(b\) is missing/);
    refuses('attempt(() => run(), (e) => 0)', /argument 3 \(cleanup\) is missing/);
    refuses('attempt(() => run(), undefined, () => done())', /argument 2 \(recover\) is missing/);
    refuses('lessThan(a)', /argument 2 \(b\) is missing/);
  });
  test('choose and match need the catalog case count and a fallback', () => {
    refuses('choose([[c1, () => a]], () => f)', /2 cases, this call has 1/);
    refuses('choose([[c1, () => a], [c2, () => b], [c3, () => c]], () => f)', /2 cases, this call has 3/);
    refuses('choose([[c1, () => a], [c2, () => b]])', /fallback is missing/);
    refuses('match(v, { a: () => 1, b: () => 2 }, () => 3)', /1 case, this call has 2/);
    refuses('match(v, { a: () => 1 })', /fallback is missing/);
    refuses('choose(cases, () => f)', /not a list literal/);
    refuses('match(v, { [k]: () => 1 }, () => 3)', /computed or spread/);
  });
  test('an atom without a catalog sentence, or not an atom call', () => {
    refuses('times(a, b)', /^atom has no fluent$/);
    refuses('parseInteger(s)', /^atom has no fluent$/);
    refuses('notAnAtom(a)', /^not a catalog atom$/);
    refuses('a.b(c)', /^not an atom call$/);
    refuses('equals(...pair)', /^spread argument$/);
    refuses('hasItem(xs, 3, 1)', /argument 3 has no place/);
  });
  test('the catalog is required', () => {
    assert.throws(() => toFluent('equals(a, b)'), /catalog is required/);
  });
  test('accepts a Babel CallExpression and a compiled catalog', () => {
    const node = parser.parseExpression('isNothing(user.name)');
    assert.equal(fluent(node, RAW), 'checks().if(user.name).is().nothing()');
    const compiled = loadCatalog(CATALOG_PATH);
    assert.equal(fluent('atLeast(n, 2)', compiled), 'checks().if(n).is().at().least(2)');
  });
});

describe('fluentFor', () => {
  const catalog = loadCatalog(CATALOG_PATH);
  const run = (code) => {
    const r = fluentFor(code, { catalog });
    for (const { sentence } of r.sentences) produced.push({ call: code, sentence });
    return r;
  };
  test('toAtoms then every atom call becomes a sentence, innermost first', () => {
    const r = run("function f(x) { return typeof x === 'string' && x.trim().toLowerCase(); }");
    assert.match(r.code, /checks\(\)\.if\(checks\(\)\.if\(x\)\.is\(\)\.text\(\)\)\.and\(\(\) => clones\(\)\.text\(clones\(\)\.text\(x\)\.and\(\)\.trims\(\)\)\.and\(\)\.lowercases\(\)\)/);
    assert.equal(r.full, true);
    assert.equal(r.plain, 0);
  });
  test('an atom without a fluent stays a plain call and is reported', () => {
    const r = run('function f(xs) { return xs.map((v) => v * 2); }');
    assert.equal(r.full, false);
    assert.deepEqual(r.reasons, [{ atom: 'times', reason: 'atom has no fluent' }]);
    assert.match(r.code, /clones\(\)\.list\(xs\)\.and\(\)\.maps\(\)\.each\(\)\.with\(v => times\(v, 2\)\)/);
  });
  test('a switch becomes a matches() sentence', () => {
    const r = run("function f(x) { switch (x) { case 'a': return 1; default: return 3; } }");
    assert.match(r.code, /matches\(\)\.value\(x\)\.on\("a"\)\.yields\(\(\) => 1\)\.otherwise\(\(\) => 3\)/);
  });
  test('a call the grammar has no sentence for stays plain, with its reason', () => {
    const r = run("function f(x) { switch (x) { case 'a': return 1; case 'b': return 2; default: return 3; } }");
    assert.equal(r.full, false);
    assert.deepEqual(r.reasons, [{ atom: 'match', reason: 'the catalog sentence has 1 case, this call has 2' }]);
  });
});

describe('every produced sentence passes the R1-R9 grammar gate', () => {
  let checkGrammar;
  before(async () => {
    ({ checkGrammar } = await import(GRAMMAR_PATH));
  });
  test('every catalog sentence, written with its own parameter names, comes back and passes', () => {
    // choose, match and attempt have no check params; their round-trips are in the first suite
    const withFluent = RAW.atoms.filter((a) => a.fluent && a.check && a.check[0] && a.check[0].params);
    assert.ok(withFluent.length >= 34, `${withFluent.length} catalog atoms with a sentence and params`);
    for (const a of withFluent) {
      // the leading params the sentence has words for (hasItem's fromIndex has none)
      const params = a.check[0].params.map(([n]) => n);
      let call, s;
      for (let k = params.length; k >= 1 && !s; k--) s = fluent((call = `${a.atom}(${params.slice(0, k).join(', ')})`));
      assert.ok(s, `${call}: ${explainFluent(call, RAW).reason}`);
      assert.deepEqual(checkGrammar({ sentence: s }), { check: 'pass', errors: [], fixes: [] }, `${call} -> ${s}`);
    }
  });
  test('every sentence the tests above produced', () => {
    assert.ok(produced.length >= 20, `${produced.length} sentences`);
    for (const { call, sentence } of produced) {
      const g = checkGrammar({ sentence });
      assert.equal(g.check, 'pass', `${typeof call === 'string' ? call : '(node)'} -> ${sentence}: ${g.errors.join(' ')}`);
    }
  });
});
