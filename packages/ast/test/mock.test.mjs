// LINE-MODULE: @construct/ast's mock stands in for the real entry: same names, same kinds of value, same result shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as real from '@construct/ast';
import * as mock from '../mock.mjs';

test('every name the mock exports is a name of the real entry, of the same kind', () => {
  for (const [name, value] of Object.entries(mock)) {
    assert.ok(name in real, `${name} is not exported by @construct/ast`);
    assert.equal(typeof value, typeof real[name], `${name}: mock is ${typeof value}, real is ${typeof real[name]}`);
  }
});

test('parseToAst gives a Program with the same top-level fields and span as the real parser', () => {
  const src = 'const a = 1;\nexport { a };';
  const r = real.parseToAst(src);
  const m = mock.parseToAst(src);
  assert.equal(m.type, r.type);
  assert.equal(m.sourceType, r.sourceType);
  for (const k of Object.keys(r)) assert.ok(k in m, `mock Program lacks ${k}`);
  assert.deepEqual(m.loc, r.loc);
  assert.deepEqual(m.range, [0, src.length]);
});

test('walkAst visits a hand-built tree in the same order as the real walker', () => {
  const tree = { type: 'Program', body: [{ type: 'ExpressionStatement', expression: { type: 'Identifier', name: 'x' } }] };
  const order = (walk) => { const seen = []; walk(structuredClone(tree), { enter: (n) => seen.push(n.type) }); return seen; };
  assert.deepEqual(order(mock.walkAst), order(real.walkAst));
});

test('lineOf agrees with the real one; extract* answer empty lists of the real element type', () => {
  const src = 'a\nb\nc';
  assert.equal(mock.lineOf(src, 4), real.lineOf(src, 4));
  assert.deepEqual(mock.extractImports('import x from "y"'), []);
  assert.deepEqual(mock.extractExports('export const a = 1'), []);
  assert.equal(typeof real.extractImports('import x from "y"')[0], 'string');
});
