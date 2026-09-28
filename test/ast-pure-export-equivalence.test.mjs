// #749 -- packages/ast/pureExportEquivalence.mjs: fast-check equivalence for pure exports touched by a
// staged edit, the second slice of epic #461's "Change check".
import test from 'node:test';
import assert from 'node:assert/strict';
import { pureExportEquivalence } from '../packages/ast/pureExportEquivalence.mjs';
import * as ast from '../packages/ast/index.mjs';

test('re-exported from the AST package entry point', () => {
  assert.equal(ast.pureExportEquivalence, pureExportEquivalence);
});

test('behaviour change on typed pure parameters: diverged, with a concrete counter-example', () => {
  const before = 'export const total = (a: number, b: number) => a + b;';
  const after = 'export const total = (a: number, b: number) => a - b;';
  const { checked, skipped } = pureExportEquivalence(before, after);
  assert.deepEqual(skipped, []);
  assert.equal(checked.length, 1);
  assert.equal(checked[0].name, 'total');
  assert.equal(checked[0].verdict, 'diverged');
  assert.equal(checked[0].input.length, 2);
});

test('a true behaviour-preserving refactor on typed pure parameters: equivalent', () => {
  const before = 'export function total(a: number, b: number) { return a + b; }';
  const after = 'export function total(a: number, b: number) { const sum = a + b; return sum; }';
  const { checked, skipped } = pureExportEquivalence(before, after);
  assert.deepEqual(skipped, []);
  assert.deepEqual(checked, [{ name: 'total', verdict: 'equivalent' }]);
});

test('an impure export (reads a global) is skipped, not guessed at', () => {
  const before = 'export const total = (a: number) => a + globalThis.offset;';
  const after = 'export const total = (a: number) => a + globalThis.offset + 1;';
  const { checked, skipped } = pureExportEquivalence(before, after);
  assert.deepEqual(checked, []);
  assert.deepEqual(skipped, [{ name: 'total', reason: 'not detected as pure' }]);
});

test('an untyped parameter is skipped: no arbitrary can be chosen without guessing', () => {
  const before = 'export const total = (a, b) => a + b;';
  const after = 'export const total = (a, b) => a - b;';
  const { checked, skipped } = pureExportEquivalence(before, after);
  assert.deepEqual(checked, []);
  assert.deepEqual(skipped, [{ name: 'total', reason: 'unsupported parameter types' }]);
});

test('an untouched pure export (identical source) is neither checked nor skipped', () => {
  const before = 'export const total = (a: number, b: number) => a + b;\nexport const other = 1;';
  const after = 'export const total = (a: number, b: number) => a + b;\nexport const other = 2;';
  const { checked, skipped } = pureExportEquivalence(before, after);
  assert.deepEqual(checked, []);
  assert.deepEqual(skipped, []);
});

test('a removed export has nothing to compare against: neither checked nor skipped', () => {
  const before = 'export const total = (a: number, b: number) => a + b;';
  const after = 'export const other = 1;';
  const { checked, skipped } = pureExportEquivalence(before, after);
  assert.deepEqual(checked, []);
  assert.deepEqual(skipped, []);
});

test('array-typed pure parameters are supported', () => {
  const before = 'export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);';
  const after = 'export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 1);';
  const { checked, skipped } = pureExportEquivalence(before, after);
  assert.deepEqual(skipped, []);
  assert.equal(checked.length, 1);
  assert.equal(checked[0].verdict, 'diverged');
});

test('unparsable source: nothing checked or skipped, reason set', () => {
  const { checked, skipped, reason } = pureExportEquivalence('export const x = (', 'export const x = 1;');
  assert.deepEqual(checked, []);
  assert.deepEqual(skipped, []);
  assert.match(reason, /parse error/);
});
