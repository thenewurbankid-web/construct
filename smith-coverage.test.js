// S5: Smith coverage rules. Every Babel Expression/Statement type has an
// English rule, and each common shape reads the way these tests pin down.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const t = require('@babel/types');
const { toEnglish: toEnglishAnyStyle, EXPR_RULES, STMT_RULES } = require('./to-english');
// These tests pin the original word-for-word reading: { style: 'exact' }.
const toEnglish = (code, kind, options = {}) => toEnglishAnyStyle(code, kind, { style: 'exact', ...options });


const step = (body, kind = 'function', i = 0) => {
  const code = kind === 'method' ? `run(a, b) {\n${body}\n}` : `function run(a, b) {\n${body}\n}`;
  const r = toEnglish(code, kind);
  assert.deepEqual(r.unhandled, [], `unhandled in: ${body}`);
  return r.steps[i].english;
};

test('every Babel Expression type has an English rule (none can fall back to "(...)")', () => {
  const missing = t.FLIPPED_ALIAS_KEYS.Expression.filter((type) => !EXPR_RULES[type]);
  assert.deepEqual(missing, []);
});

test('every Babel Statement type has an English rule (none can fall back to "does not translate cleanly")', () => {
  const missing = t.FLIPPED_ALIAS_KEYS.Statement.filter((type) => !STMT_RULES[type]);
  assert.deepEqual(missing, []);
});

test('ObjectExpression: keys, shorthand, spread, computed key, method, empty', () => {
  assert.equal(step('return { name: a, b, ...rest, [k]: 1 };'), 'return an object with name as a and b and everything in rest and key k as 1');
  assert.equal(step('return {};'), 'return an empty object');
  assert.equal(step('return { go() { return a; } };'), 'return an object with go as return a');
});

test('ArrayExpression: elements, spread, hole, empty', () => {
  assert.equal(step('return [a, ...b, , 3];'), 'return a list of a and everything in b and an empty slot and 3');
  assert.equal(step('return [];'), 'return an empty list');
});

test('TemplateLiteral and tagged templates', () => {
  assert.equal(step('return `Hello ${a}!`;'), "return text of 'Hello ' and a and '!'");
  assert.equal(step('return `plain`;'), "return 'plain'");
  assert.equal(step('return css`color: ${a}`;'), "return css of 'color: ' and a");
});

test('LogicalExpression and ConditionalExpression', () => {
  assert.equal(step('return a && b || c;'), 'return a and b or c');
  assert.equal(step('return a ?? b;'), 'return a if present, otherwise b');
  assert.equal(step('return a ? b : 1;'), 'return if a then b, otherwise 1');
});

test('optional member and call say "(if any)" once per chain', () => {
  assert.equal(step('return a?.b.c;'), "return a's b's c (if any)");
  assert.equal(step('return a.load?.(b);'), 'return a load b (if any)');
  assert.equal(step('return f(a?.b, b?.c);'), "f of a's b (if any) and b's c (if any)".replace(/^/, 'return '));
});

test('await, spread argument, update, unary words', () => {
  assert.equal(toEnglish('async function run(a) {\n  return await a.load();\n}', 'function').steps[0].english, 'return wait for a load');
  assert.equal(step('f(...a);'), 'f of everything in a');
  assert.equal(step('a++;'), 'increase a by 1');
  assert.equal(step('--a;'), 'decrease a by 1');
  assert.equal(step('return typeof a;'), 'return the type of a');
  assert.equal(step('a += 2;'), 'add 2 to a');
  assert.equal(step('a ??= b;'), 'set a to a if present, otherwise b');
});

test('FunctionExpression reads as its body, like an arrow', () => {
  assert.equal(step('return a.map(function (x) { return x.id; });'), "return a map return x's id");
});

test('TS-only expressions are transparent', () => {
  assert.equal(step('return (a as Foo)!.b satisfies Bar;'), "return a's b");
});

test('for, while, do-while loops', () => {
  assert.equal(step('for (let i = 0; i < a; i++) f(i);'), 'starting with let i be 0, repeat while i < a, after each pass increase i by 1: f of i');
  assert.equal(step('for (;;) f();'), 'repeat forever: f');
  assert.equal(step('while (a) b++;'), 'while a: increase b by 1');
  assert.equal(step('do { b++; } while (a);'), 'repeat: increase b by 1, as long as a');
});

test('switch groups fall-through cases and drops the trailing break', () => {
  const s = step("switch (a) {\n case 'x':\n case 'y':\n  f();\n  break;\n default:\n  g();\n}");
  assert.equal(s, "depending on a: when 'x' or 'y': f; otherwise: g");
});

test('try/catch/finally, throw, break and continue', () => {
  assert.equal(step('try { f(); } catch (e) { g(e); } finally { h(); }'), 'try: f, if it fails with e: g of e, finally: h');
  assert.equal(step("throw new Error('no');"), "fail with a new Error of 'no'");
  assert.equal(step('for (const x of a) { if (x) break; continue; }'), 'for each x of a: if x: stop the loop; then skip to the next pass');
});

test('destructured and default params in the title, rename-aware', () => {
  const r = toEnglish('function f({ a, b: c, d = 1, ...rest }: P, [x] = [], ...more) {\n  return c;\n}', 'function');
  assert.deepEqual(r.unhandled, []);
  assert.equal(r.title, 'f using {a, b as c, d (default 1), ...rest} and [x] (default an empty list) and ...more');
});

test('destructured declarator is rename-aware', () => {
  assert.equal(step('const { a: first, c } = a;'), 'let {a as first, c} be a');
});

test('JSX: element with attributes and children reads as "shows a <Tag> with ... containing ..."', () => {
  const r = toEnglish('function Card({ title }) {\n  return <div className="card" hidden onClick={() => go(title)}>Hi {title}<b>!</b></div>;\n}', 'function');
  assert.deepEqual(r.unhandled, []);
  assert.equal(r.steps[0].english, "return shows a <div> with className as 'card' and hidden and onClick as go of title containing 'Hi' and title and a <b> containing '!'");
});

test('JSX: fragments, spread attributes, member tags, mapped children', () => {
  const r = toEnglish('function L({ items, p }) {\n  return <><UI.Item {...p} />{items.map((i) => <li key={i.id}>{i.name}</li>)}</>;\n}', 'function');
  assert.deepEqual(r.unhandled, []);
  assert.equal(r.steps[0].english, "return shows a group containing a <UI.Item> with everything in p and items map a <li> with key as i's id containing i's name");
});

test('nested declarations are named, not expanded', () => {
  assert.equal(step('function inner(x) { return x; }'), 'define inner using x: return x');
  assert.equal(step('type T = string;'), 'define the type T');
  assert.equal(step('class K {}'), 'define a class K');
});

test('the placeholder path still records an unhandled entry for a node type with no rule', () => {
  const { STMT_RULES: rules, clearEnglishCache } = require('./to-english');
  clearEnglishCache();
  const saved = rules.EmptyStatement;
  delete rules.EmptyStatement;
  try {
    const r = toEnglish('function run() {\n  ;\n}', 'function');
    assert.equal(r.steps[0].english, '(a step that does not translate cleanly)');
    assert.deepEqual(r.unhandled.map((u) => [u.kind, u.type]), [['stmt', 'EmptyStatement']]);
  } finally {
    rules.EmptyStatement = saved;
    clearEnglishCache();
  }
});
