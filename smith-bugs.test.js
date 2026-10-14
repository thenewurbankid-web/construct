// S6: regression tests for the four Smith bugs found in review.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toEnglish: toEnglishAnyStyle, EXPR_RULES } = require('./to-english');
// These tests pin the original word-for-word reading: { style: 'exact' }.
const toEnglish = (code, kind, options = {}) => toEnglishAnyStyle(code, kind, { style: 'exact', ...options });


const steps = (body) => toEnglish(`function run(a, b) {\n${body}\n}`, 'function').steps;
const noEmptyOrUndefined = (s) => {
  for (const tk of s.tokens) {
    assert.notEqual(tk.text, '', 'empty chip');
    assert.notEqual(tk.text, undefined, 'undefined chip');
  }
  assert.doesNotMatch(s.english, /undefined/);
};

test('bug 1: a destructured for-of / for-in variable no longer reads "for each undefined"', () => {
  const [s] = steps('for (const [k, v] of a) f(k, v);');
  noEmptyOrUndefined(s);
  assert.equal(s.english, 'for each [k, v] of a: f of k and v');
  assert.equal(s.tokens[1].text, '[k, v]');
  const [s2] = steps('for (const { id } in a) f(id);');
  assert.equal(s2.english, 'for each {id} in a: f of id');
});

test('bug 2: new a.B() no longer reads "a new undefined"', () => {
  const [s] = steps('return new a.B(b);');
  noEmptyOrUndefined(s);
  assert.equal(s.english, 'return a new B from a of b');
  const [s2] = steps('return new (f())();');
  noEmptyOrUndefined(s2);
});

test('bug 3: a computed, IIFE, curried or super callee no longer gets an empty verb', () => {
  const cases = {
    'a[b](1);': 'call a at b with 1',
    '(() => a)();': 'call a',
    'f(a)(b);': 'call f of a with b',
    'this.#go(a);': 'it go a',
  };
  for (const [body, english] of Object.entries(cases)) {
    const code = body.includes('#') ? `class K {\n  #go() {}\n  run(a, b) {\n    ${body}\n  }\n}` : `function run(a, b) {\n${body}\n}`;
    const r = toEnglish(code, 'function', { all: true });
    const fn = r.functions.find((f) => f.name === 'run');
    noEmptyOrUndefined(fn.steps[0]);
    assert.equal(fn.steps[0].english, english);
  }
});

test('bug 4: BinaryExpression has exactly one rule (the dead duplicate case is gone)', () => {
  const src = require('fs').readFileSync(require.resolve('./to-english'), 'utf8');
  assert.equal(src.match(/^\s+BinaryExpression[:(]/gm).length, 1);
  assert.equal(typeof EXPR_RULES.BinaryExpression, 'function');
  assert.equal(steps('return a + b;')[0].english, 'return a + b');
});
