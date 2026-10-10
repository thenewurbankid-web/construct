// The expression evaluator is the boundary between a model's text and this process: nothing outside its allow-list may run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evalExpression, MAX_CHARS } from "./safe-eval.mjs";

const scope = () => ({
  item: { first: "Lena", last: "Kumar", n: 3.14159, tags: ["a", "b"], nested: { deep: "x" }, none: null },
  items: [{ name: "a", v: 1 }, { name: "b", v: 2 }, { name: "c", v: 3 }],
  data: { total: 12, label: "Total" },
});
const NOT_ALLOWED = (e) => e instanceof Error && /^expression not allowed/.test(e.message);
const FAILED = (e) => e instanceof Error && /^expression failed/.test(e.message);
const CLEAN = (e) => e instanceof Error && /^expression (not allowed|failed)/.test(e.message);

test("what real drafts use keeps working", () => {
  const s = scope();
  const ok = [
    ["[item.first, item.last].join(' ')", "Lena Kumar"],
    ['item.first.toUpperCase() + " " + item.last.slice(0, 1)', "LENA K"],
    ["`${item.first} ${item.last}`", "Lena Kumar"],
    ["item.first[0] + item.last[0]", "LK"],
    ["item.n.toFixed(2)", "3.14"],
    ["item.tags.join(', ')", "a, b"],
    ["items.map(i => i.name).join('/')", "a/b/c"],
    ["items.filter(i => i.v > 1).length", 2],
    ["data.total > 10 ? 'many' : 'few'", "many"],
    ["item.none ?? 'n/a'", "n/a"],
    ["item.missing?.deep.x", undefined],
    ["item.nested?.deep", "x"],
    ["item.first.padStart(6, '*')", "**Lena"],
    ["item.first.replace('L', 'l')", "lena"],
    ["item.first.split('e').length", 2],
    ["Math.round(item.n * 100) / 100", 3.14],
    ["String(items.length) + ' rows'", "3 rows"],
    ["Number('4') + 1", 5],
    ["!item.none && typeof item.first === 'string'", true],
    ["items[0].name", "a"],
    ["item['first']", "Lena"],
    ["(1 + 2) * 3", 9],
  ];
  for (const [e, want] of ok) assert.deepEqual(evalExpression(e, s), want, e);
});

test("the reviewer's escape, and every other way to reach the host, throws 'expression not allowed'", () => {
  const hostile = [
    'item["constr"+"uctor"]["constr"+"uctor"]("return typeof pro"+"cess")()', // the confirmed escape
    'item["constr" + "uctor"]',
    '[].constructor.constructor("return process")()',
    "item.constructor",
    "item.constructor.constructor('return process')()",
    "item.first.constructor",
    "item['__proto__']",
    "item.__proto__",
    "item.__defineGetter__('x', () => 1)",
    "item.__lookupGetter__('x')",
    "this",
    "this.constructor",
    "globalThis",
    "globalThis.process",
    "process",
    "process.exit(1)",
    "require('fs')",
    "import('fs')",
    "(() => 1)()",
    "(function () { return 1 })()",
    "(() => 1)",
    "item.first.toUpperCase.call",
    "item.first.toUpperCase.constructor('return process')()",
    "item.first.charAt.bind(item)()",
    "new Function('return 1')",
    "new Date()",
    "Function('return process')()",
    "eval('1')",
    "item.first = 'x'",
    "item.count++",
    "delete item.first",
    "a; b",
    "1; process.exit()",
    "/x/.test(item.first)",
    "item.first.match(/a/)",
    "item.first.replace(/a/g, 'b')",
    "({}).constructor",
    "({ get x() { return process } }).x",
    "[...items]",
    "item.tags.sort()",
    "item.tags.reverse()",
    "item.tags.map(process.exit)",
    "items.map(function (i) { return i })",
    "items.map(i => { return 1 })",
    "items.map(i => i.constructor)",
    "items.map(async i => i)",
    "items.map(constructor => 1)",
    "`${item.constructor}`",
    "item[`constructor`]",
    "item[item.first]",
    "item[0 + 'x']",
    "'a' in item",
    "item instanceof Object",
    "item.first `x`",
    "1, 2",
    "await item",
    "yield 1",
    "class A {}",
    "a?.()",
    "item.first?.toUpperCase?.()",
    "'x'.repeat(100000)",
    "'x'.padStart(1e9)",
    "item.n.toFixed(500)",
    "// comment\nitem.first",
    "item.first /* c */",
    "",
    "   ",
    "item.first +",
    "\u0000",
    "item.\\u0063onstructor",
    'item["\\u0063onstructor"]',
    "item.first.__proto__.__proto__",
    "Object.keys(item)",
    "Reflect.ownKeys(item)",
    "JSON.stringify(item)",
    "Math.constructor",
    "Math.random()",
    "String.constructor('return process')()",
    "String.prototype",
    "Symbol.iterator",
  ];
  for (const e of hostile) assert.throws(() => evalExpression(e, scope()), NOT_ALLOWED, JSON.stringify(e));
});

test("own properties only: nothing is reachable through a prototype chain, and accessors are refused", () => {
  const proto = { inherited: "secret" };
  const s = { item: Object.create(proto) };
  s.item.own = "ok";
  assert.throws(() => evalExpression("item.inherited", s), NOT_ALLOWED); // the chain is refused, not followed
  // a value with a custom prototype is not plain data: nothing is read
  assert.equal(evalExpression("item.own", s), undefined);
  assert.equal(evalExpression("item.x", { item: Object.assign(Object.create(null), { x: "null-proto ok" }) }), "null-proto ok");
  for (const e of ["item.toString", "item.hasOwnProperty", "item.valueOf"]) assert.throws(() => evalExpression(e, { item: {} }), NOT_ALLOWED, e); // inherited names are refused
  const g = { item: Object.defineProperty({}, "x", { get() { throw new Error("getter ran"); }, enumerable: true }) };
  assert.throws(() => evalExpression("item.x", g), NOT_ALLOWED);
  const f = { item: { fn: () => "ran" } };
  assert.throws(() => evalExpression("item.fn", f), NOT_ALLOWED);
  assert.throws(() => evalExpression("item.fn()", f), NOT_ALLOWED);
  assert.throws(() => evalExpression("item", { item: () => 1, other: 1 }) && evalExpression("item()", { item: () => 1 }), NOT_ALLOWED);
});

test("a legal expression that fails at run time says so, and is not a leak", () => {
  assert.throws(() => evalExpression("item.a.b", { item: {} }), FAILED);
  assert.throws(() => evalExpression("item.a.toUpperCase()", { item: {} }), CLEAN);
  assert.throws(() => evalExpression("nope", {}), NOT_ALLOWED);
});

test("size and step limits: a huge or runaway expression is stopped without a timer", () => {
  assert.throws(() => evalExpression("1" + "+1".repeat(MAX_CHARS), {}), NOT_ALLOWED);
  assert.throws(() => evalExpression("(".repeat(500) + "1" + ")".repeat(500), {}), NOT_ALLOWED);
  const big = { items: Array.from({ length: 4000 }, (_, i) => ({ i })) };
  assert.throws(() => evalExpression("items.map(a => items.map(b => a.i + b.i).length).length", big), (e) => /more than 10000 steps/.test(e.message));
  assert.throws(() => evalExpression("items.map(a => 'x'.repeat(1000)).join('').concat(items.map(a => 'y'.repeat(1000)).join(''))", { items: Array.from({ length: 200 }, () => 1) }), NOT_ALLOWED);
});

// A small seeded generator of hostile strings: the same seed always yields the same cases.
function rng(seed) { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; }; }

test("fuzz (seeded): hostile strings never run anything, never return the host, never hang", () => {
  const r = rng(20260927);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const heads = ["item", "items", "data", "this", "globalThis", "process", "[]", "''", "0", "(() => 1)", "Function", "Object", "Reflect", "String", "Math"];
  const links = [".constructor", "['constructor']", "['constr'+'uctor']", ".__proto__", "['__proto__']", ".prototype", ".call", ".apply", ".bind(item)", "()", "('return process')", "('return process')()", ".toString", ".valueOf", "[0]", ".length", ".x", "?.y", "?.()", ".map(i => i)", ".join('')", ".sort()", " + ''"];
  const junk = ["`${process}`", "a=>a", "1;2", "{}", "...x", "@", "#x", "\\u0063", "'", "\"", "`", "(", ")", "["];
  const seen = new Set();
  let hardBlocked = 0;
  for (let n = 0; n < 1500; n++) {
    let e = pick(heads);
    for (let k = Math.floor(r() * 5); k >= 0; k--) e += pick(links);
    if (r() < 0.15) e += pick(junk);
    if (r() < 0.05) e = pick(junk) + e;
    if (seen.has(e)) continue;
    seen.add(e);
    let out, threw = null;
    try { out = evalExpression(e, scope()); } catch (err) { threw = err; }
    if (threw) {
      assert.match(threw.message, /^expression (not allowed|failed)/, `${e} threw a non-clean error: ${threw.message}`);
      if (/^expression not allowed/.test(threw.message)) hardBlocked++;
    } else {
      assert.notEqual(typeof out, "function", e);
      assert.ok(out === undefined || typeof out !== "object" || Array.isArray(out), e);
      assert.notEqual(out, process, e);
      assert.ok(!JSON.stringify(out ?? null).includes("process"), e);
    }
  }
  assert.ok(seen.size > 800 && hardBlocked > 400, `fuzz too small (${seen.size} cases, ${hardBlocked} blocked)`);
});

test("expression text that names anything hostile is refused however it is spelled", () => {
  for (const key of ["constructor", "prototype", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]) {
    for (const e of [`item.${key}`, `item["${key}"]`, `item?.${key}`, `item.first.${key}`, `items.map(i => i.${key})`, `items.map(i => i["${key}"])`]) {
      assert.throws(() => evalExpression(e, scope()), NOT_ALLOWED, e);
    }
  }
});
