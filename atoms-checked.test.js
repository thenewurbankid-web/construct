// Tests for the equivalence check (bench/atoms/equivalence.js) and the converter that
// uses it (bench/atoms/checked.js). The runtime here is a hand-written stand-in, so the
// tests do not depend on the atom runtime's repository; `sameAs` is wrong on purpose.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { compileCatalog } = require('./atoms-catalog');
const { createSandbox, typesOfSource, describeType } = require('./bench/atoms/equivalence');
const { createCheckedConverter } = require('./bench/atoms/checked');

const BUNDLE = `globalThis.__smith = {
  plus: (a, b) => a + b,
  join: (a, b) => a + b,
  times: (a, b) => a * b,
  sameAs: (a, b) => a == b,
  when: (c, a, b) => (c ? a() : b ? b() : undefined),
  part: (list, start, end) => list.slice(start, end),
  sliceText: (text, start, end) => text.slice(start, end),
};`;
const catalog = (extra = []) => compileCatalog([
  { atom: 'plus', js: ['a + b'], params: ['a', 'b'], firstKinds: ['number'] },
  { atom: 'join', js: ['a + b'], params: ['a', 'b'], firstKinds: ['string'] },
  { atom: 'times', js: ['a * b'], params: ['a', 'b'] },
  { atom: 'when', js: ['c ? a : b'], params: ['condition', 'then', 'otherwise?'] },
  { atom: 'part', js: ['list.slice(start, end)'], params: ['list', 'start?', 'end?'], firstKinds: ['list'] },
  { atom: 'sliceText', js: ['text.slice(start, end)'], params: ['text', 'start?', 'end?'], firstKinds: ['string'] },
  ...extra,
]);

describe('the equivalence check', () => {
  let sandbox;
  before(async () => { sandbox = await createSandbox({ bundle: BUNDLE }); });
  after(() => sandbox.dispose());

  test('a faithful conversion is the same on every run', () => {
    const res = sandbox.checkPair({
      original: 'function area(w: number, h: number) { return w * h; }',
      converted: 'function area(w: number, h: number) { return times(w, h); }',
      importDecl: "import { times } from 'smith';",
    });
    assert.equal(res.status, 'same');
    assert.equal(res.compared, 25);
    assert.equal(res.exercised, 25);
    assert.equal(res.atomCalls.times.calls, 25);
  });

  test('swapped arguments are caught, with the input that shows it', () => {
    const res = sandbox.checkPair({
      original: 'function label(first: string, last: string) { return first + last; }',
      converted: 'function label(first: string, last: string) { return join(last, first); }',
      importDecl: "import { join } from 'smith';",
    });
    assert.equal(res.status, 'different');
    assert.equal(res.mismatches[0].differs, 'outcome');
    assert.match(res.mismatches[0].input, /^\[/);
  });

  test('a call to the outside made in another order is caught by the trace', () => {
    const res = sandbox.checkPair({
      original: 'function run() { log("a"); log("b"); }',
      converted: 'function run() { log("b"); log("a"); }',
    });
    assert.equal(res.status, 'different');
    assert.equal(res.mismatches[0].differs, 'trace');
  });

  test('a changed argument is caught even when the result is equal', () => {
    const res = sandbox.checkPair({
      original: 'function first(xs: number[]) { return xs.length; }',
      converted: 'function first(xs: number[]) { const n = xs.length; xs.push(1); return n; }',
    });
    assert.equal(res.status, 'different');
    assert.equal(res.mismatches[0].differs, 'arguments afterwards');
  });

  test('async functions are compared by what they settle to', () => {
    const res = sandbox.checkPair({
      original: 'async function load(id: string) { const r = await api.get(id); return r; }',
      converted: 'async function load(id: string) { await api.get(id); return undefined; }',
    });
    assert.equal(res.status, 'different');
    assert.match(res.mismatches[0].converted.out, /^resolves undefined/);
  });

  test('the clock and Math.random are seeded, so impure code compares equal to itself', () => {
    const code = 'function stamp() { return [Date.now(), Math.random(), new Date().getTime()]; }';
    assert.equal(sandbox.checkPair({ original: code, converted: code }).status, 'same');
  });

  test('an endless loop is cut off and that run is not compared', () => {
    const res = sandbox.checkPair({ original: 'function spin() { for (;;) {} }', converted: 'function spin() { return 1; }', runs: 2 });
    assert.equal(res.compared, 0);
    assert.equal(res.timeouts, 2);
  });

  test('argument types come from the annotations, resolved in the same file', () => {
    const env = typesOfSource("type Status = 'open' | 'closed';\ninterface Ticket { id: string; status: Status; tags?: string[] }\nfunction f(t: Ticket) {}");
    assert.deepEqual(describeType(env.get('Ticket'), env), {
      k: 'object',
      fields: [
        { name: 'id', optional: false, d: { k: 'string' } },
        { name: 'status', optional: false, d: { k: 'union', of: [{ k: 'lit', v: 'open' }, { k: 'lit', v: 'closed' }] } },
        { name: 'tags', optional: true, d: { k: 'array', of: { k: 'string' } } },
      ],
    });
  });
});

describe('convert, check, repair', () => {
  const converters = [];
  const converterFor = async (compiled) => { const c = await createCheckedConverter({ compiled, bundle: BUNDLE }); converters.push(c); return c; };
  after(() => converters.forEach((c) => c.dispose()));
  const flat = (s) => s.replace(/\s+/g, ' ').trim();

  test('where two atoms fit, each is tried and the one whose kind of value arrives is kept', async () => {
    const c = await converterFor(catalog());
    const sum = c.convert('function total(a: number, b: number) { return a + b; }');
    assert.equal(flat(sum.body), 'function total(a: number, b: number) { return plus(a, b); }');
    assert.deepEqual(sum.decisions[0].tried.map((x) => [x.atom, x.works]), [['plus', true], ['join', false]]);
    const text = c.convert('function full(a: string, b: string) { return a + b; }');
    assert.equal(flat(text.body), 'function full(a: string, b: string) { return join(a, b); }');
    const tail = c.convert('function rest(xs: number[]) { return xs.slice(1); }');
    assert.equal(flat(tail.body), 'function rest(xs: number[]) { return part(xs, 1); }');
    assert.equal(tail.check.status, 'same');
  });

  test('a place that receives both kinds of value is left as it was, with the reason', async () => {
    const c = await converterFor(catalog());
    const out = c.convert('function add(a: string | number, b: string | number) { return a + b; }');
    assert.equal(flat(out.body), 'function add(a: string | number, b: string | number) { return a + b; }');
    assert.equal(out.decisions[0].chosen, null);
    assert.equal(out.decisions[0].note, 'it receives more than one kind of value');
  });

  test('a place no input reaches is left as it was', async () => {
    const c = await converterFor(catalog());
    const out = c.convert('function never(a: number, b: number) { if (false) { return a + b; } return 0; }');
    assert.match(out.body, /a \+ b/);
    assert.equal(out.decisions[0].note, 'no input reached it with a real value');
  });

  test('a rewrite that changes behaviour is taken back, the others stay, and the evidence is reported', async () => {
    // the catalog wrongly claims `a === b` for an atom that compares loosely
    const c = await converterFor(catalog([{ atom: 'sameAs', js: ['a === b'], params: ['a', 'b'] }]));
    const out = c.convert("function pick(a: string | number, b: string | number, n: number) { return a === b ? n * 2 : n * 3; }", { runs: 60 });
    assert.equal(flat(out.body), "function pick(a: string | number, b: string | number, n: number) { return when(a === b, () => times(n, 2), () => times(n, 3)); }");
    assert.equal(out.check.status, 'same');
    assert.equal(out.rejected.length, 1);
    assert.equal(out.rejected[0].atom, 'sameAs');
    assert.equal(out.rejected[0].source, 'a === b');
    assert.notEqual(out.rejected[0].evidence.original.out, out.rejected[0].evidence.converted.out);
    assert.deepEqual(out.untranslated.map((u) => u.reason), ['failed the check']);
  });
});
