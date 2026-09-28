// #747 -- packages/ast/semanticDiff.mjs: the AST-level behaviour-preserving verdict, part of epic #461's
// "Change check" (a live indicator before saving, not only a PR/CI check).
import test from 'node:test';
import assert from 'node:assert/strict';
import { semanticDiff, SEMANTIC_DIFF_VERDICTS, SEMANTIC_DIFF_OPERATIONS } from '../packages/ast/semanticDiff.mjs';
import * as ast from '../packages/ast/index.mjs';

test('re-exported from the AST package entry point', () => {
  assert.equal(ast.semanticDiff, semanticDiff);
  assert.deepEqual(ast.SEMANTIC_DIFF_VERDICTS, SEMANTIC_DIFF_VERDICTS);
});

test('identical source: same-behaviour, no operations', () => {
  const src = 'export function add(a, b) { return a + b; }\n';
  assert.deepEqual(semanticDiff(src, src), { verdict: 'same-behaviour', operations: [] });
});

test('reformatted whitespace/semicolons only: same-behaviour, reformatted', () => {
  const before = 'export function add(a,b){return a+b}';
  const after = 'export function add(a, b) {\n  return a + b;\n}\n';
  assert.deepEqual(semanticDiff(before, after), { verdict: 'same-behaviour', operations: ['reformatted'] });
});

test('pure rename (function + params) only: same-behaviour, renamed', () => {
  const before = 'function add(a, b) { return a + b; }';
  const after = 'function sum(x, y) { return x + y; }';
  assert.deepEqual(semanticDiff(before, after), { verdict: 'same-behaviour', operations: ['renamed'] });
});

test('reordered top-level declarations only: same-behaviour, reordered', () => {
  const before = 'function a() { return 1; }\nfunction b() { return 2; }\nconst c = 3;\n';
  const after = 'const c = 3;\nfunction b() { return 2; }\nfunction a() { return 1; }\n';
  assert.deepEqual(semanticDiff(before, after), { verdict: 'same-behaviour', operations: ['reordered'] });
});

test('changed conditional: changed', () => {
  const before = 'function f(x) { if (x > 0) return "pos"; return "non-pos"; }';
  const after = 'function f(x) { if (x >= 0) return "pos"; return "non-pos"; }';
  assert.deepEqual(semanticDiff(before, after), { verdict: 'changed', operations: ['changed'] });
});

test('changed operator: changed', () => {
  const before = 'const total = (a, b) => a + b;';
  const after = 'const total = (a, b) => a - b;';
  assert.deepEqual(semanticDiff(before, after), { verdict: 'changed', operations: ['changed'] });
});

test('reordering a side-effecting statement (a console.log) is not treated as behaviour-preserving', () => {
  const before = 'console.log("a"); console.log("b");';
  const after = 'console.log("b"); console.log("a");';
  assert.equal(semanticDiff(before, after).verdict, 'changed');
});

test('unparsable source: cant-tell with a reason', () => {
  const result = semanticDiff('function f( { return 1; }', 'function f() { return 1; }');
  assert.equal(result.verdict, 'cant-tell');
  assert.deepEqual(result.operations, []);
  assert.match(result.reason, /parse error/);
});

test('verdicts and operations are the documented closed sets', () => {
  assert.deepEqual(SEMANTIC_DIFF_VERDICTS, ['same-behaviour', 'changed', 'cant-tell']);
  assert.deepEqual(SEMANTIC_DIFF_OPERATIONS, ['renamed', 'reordered', 'reformatted', 'changed']);
});
