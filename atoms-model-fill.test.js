// Tests for the constraints a model's rewrite must pass (bench/atoms/model-fill.js). The
// model is replaced by canned answers and the runtime by a hand-written stand-in, so these
// need neither Ollama nor the atom runtime's repository.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { compileCatalog } = require('./atoms-catalog');
const { createCheckedConverter } = require('./bench/atoms/checked');
const { fillFunction } = require('./bench/atoms/model-fill');

const BUNDLE = `globalThis.__smith = {
  equals: (a, b) => a === b,
  when: (c, a, b) => (c ? a() : b ? b() : undefined),
  isText: (v) => typeof v === 'string',
  isNumber: (v) => typeof v === 'number',
};`;
const entries = [
  { atom: 'equals', js: ['a === b'], params: ['a', 'b'] },
  { atom: 'when', js: ['c ? a : b'], params: ['condition', 'then', 'otherwise?'] },
  { atom: 'isText', js: ["typeof value === 'string'"], params: ['value'] },
  { atom: 'isNumber', js: ["typeof value === 'number'"], params: ['value'] },
];
const compiled = compileCatalog(entries);
const noChecker = { paramTypes: () => null };

describe('a model rewrite is kept only when every constraint holds', () => {
  let converter;
  before(async () => { converter = await createCheckedConverter({ compiled, bundle: BUNDLE }); });
  after(() => converter.dispose());
  // `typeof v` alone has no atom; `typeof v === 'string'` has one
  const fn = { name: 'kind', kind: 'function', file: 'none.ts', code: "function kind(v: string | number): string {\n  const t = typeof v;\n  return t === 'string' ? 'text' : 'other';\n}" };
  const fill = (answer, f = fn) => fillFunction(f, { model: 'canned', converter, compiled, atoms: entries, checker: noChecker, types: new Map(), runs: 20, ask: async () => answer });

  test('a rewrite that keeps the behaviour and covers the gap is accepted', async () => {
    const out = await fill("function kind(v: string | number): string {\n  return when(isText(v), () => 'text', () => 'other');\n}");
    assert.equal(out.status, 'accepted', out.why);
    assert.deepEqual(out.added.sort(), ['isText', 'when']);
  });

  test('a rewrite that changes behaviour is rejected', async () => {
    const out = await fill("function kind(v: string | number): string {\n  return when(isNumber(v), () => 'text', () => 'other');\n}");
    assert.match(out.why, /^same: different/);
  });

  test('the answer handed back unchanged is rejected for leaving the gap', async () => {
    assert.match((await fill(fn.code)).why, /^fewer gaps/);
  });

  test('NO ATOM is a decline, not a failure: the function stays as it was', async () => {
    const out = await fill('NO ATOM');
    assert.equal(out.status, 'declined');
    assert.equal(out.covered, 0, 'no atom has the shape of a bare typeof here');
  });

  test('the shortlist offers the atoms whose form has the gap shape', () => {
    const { shortlist } = require('./bench/atoms/model-fill');
    const gap = { type: 'UnaryExpression', form: 'UnaryExpression typeof' };
    const shaped = compileCatalog([...entries, { atom: 'typeOf', js: ['typeof value'], params: ['value'] }]);
    const atoms = [...entries, { atom: 'typeOf', js: ['typeof value'] }];
    assert.deepEqual(shortlist([gap], atoms, new Set(), shaped).byShape, [true]);
    assert.equal(shortlist([gap], atoms, new Set(), shaped).list[0].atom, 'typeOf');
    assert.deepEqual(shortlist([gap], entries, new Set(), compiled).byShape, [false]);
  });

  test('a call to a helper the model made up is rejected', async () => {
    assert.match((await fill("function kind(v: string | number): string {\n  return kindName(v);\n}")).why, /^names: kindName/);
  });

  test('an answer that is not one function with the same parameters is rejected', async () => {
    assert.match((await fill('const kind = 1;')).why, /^parses/);
    assert.match((await fill("function kind(x: string | number): string { return when(isText(x), () => 'text', () => 'other'); }")).why, /other parameters/);
  });

  test('a call the model wrote where no input gets is rejected, though the function is the same', async () => {
    // v is never null, so the branch the model put isText in is never run
    const unreached = { ...fn, name: 'flag', code: "function flag(v: string | number): string {\n  const t = typeof v;\n  return v === null ? (t === 'string' ? 'flag' : 'flag') : 'other';\n}" };
    const out = await fill("function flag(v: string | number): string {\n  return when(equals(v, null), () => when(isText(v), () => 'flag', () => 'flag'), () => 'other');\n}", unreached);
    assert.match(out.why, /^reached: no input gets to the model's isText/);
  });
});
