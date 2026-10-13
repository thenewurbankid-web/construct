// #923 -- packages/ast/functionComplexity.mjs: per-function cyclomatic complexity from ESLint's core `complexity` rule,
// cognitive complexity from fallow's results when given (null otherwise), plus max nesting, params and returns from
// the AST. Checked against a fixture with one function per counting rule (test/fixtures/function-complexity/sample.tsx).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionComplexity, fileCyclomatic, complexityByName, eslintCyclomatic, fallowFunctions, parseToAst } from '@construct/ast';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/function-complexity/sample.tsx');
const SOURCE = fs.readFileSync(FIXTURE, 'utf8');

// name: [cyclomatic (ESLint `complexity`, classic), maxNesting, params, returns].
const EXPECTED = {
  flat: [1, 0, 1, 1],
  oneIf: [2, 1, 1, 2], //               if
  ifElseChain: [3, 1, 1, 3], //         if, else-if (a plain else is free)
  loops: [4, 2, 1, 1], //               for-of, if, while
  sw: [3, 1, 1, 3], //                  2 cases; default free
  logic: [4, 0, 4, 1], //               && && ||
  mixed: [4, 1, 3, 2], //               if, &&, ||
  tryCatch: [3, 2, 1, 2], //            catch, if; try/finally free
  ternary: [3, 2, 2, 1], //             two ?:; a concise body is 1 return
  fact: [2, 1, 1, 1], //                ?: (recursion is not a decision)
  labeled: [4, 3, 1, 0], //             for, for, if (a labelled continue is free)
  nullish: [4, 0, 2, 1], //             ESLint counts ?? (x2) and ?. (x1)
  assign: [4, 0, 1, 1], //              ||=, &&=, ??=
  Card: [2, 1, 1, 1], //                the JSX ?: only; handleClick and the map callback are their own entries
  handleClick: [3, 1, 0, 0], //         if, &&
  find: [3, 2, 1, 2], //                for, if (a class method, reported on its key)
  deep: [4, 3, 2, 2], //                if, for-in, do-while
};

test('functionComplexity: cyclomatic is ESLint\'s complexity for every fixture function; cognitive is null without fallow', () => {
  const got = functionComplexity(SOURCE);
  const named = Object.fromEntries(got.filter((f) => f.name).map((f) => [f.name, [f.cyclomatic, f.maxNesting, f.params, f.returns]]));
  assert.deepEqual(named, EXPECTED);
  assert.ok(got.every((f) => f.cognitive === null));
  const anon = got.filter((f) => !f.name);
  assert.equal(anon.length, 1, 'the .map((t) => ...) callback is the one anonymous function');
  assert.deepEqual([anon[0].cyclomatic, anon[0].params, anon[0].returns], [1, 1, 1]);
});

test('functionComplexity: the numbers are ESLint\'s own reports, one per function (class field initializers aside)', () => {
  const reports = eslintCyclomatic(SOURCE).filter((r) => !r.message.startsWith('Class field initializer'));
  const got = functionComplexity(SOURCE);
  assert.equal(reports.length, got.length);
  assert.deepEqual(reports.map((r) => r.cyclomatic).sort(), got.map((f) => f.cyclomatic).sort());
  assert.match(reports[0].message, /^Function 'flat' has a complexity of 1\./);
  assert.deepEqual(eslintCyclomatic('const y = <string>z; function f(a) { return a || 1; }').map((r) => r.cyclomatic), [2], 'an angle-bracket cast parses in TypeScript mode');
  assert.throws(() => eslintCyclomatic('function ('), /Parsing error/);
});

test('functionComplexity: entries are in source order and carry line, endLine and loc', () => {
  const got = functionComplexity(SOURCE);
  assert.deepEqual(got.map((f) => f.index), [...got.map((f) => f.index)].sort((a, b) => a - b));
  const loops = got.find((f) => f.name === 'loops');
  assert.ok(SOURCE.split('\n')[loops.line - 1].startsWith('export function loops'));
  assert.equal(loops.loc, 6);
});

test('functionComplexity: names follow the logic map (methods, properties, JSX handlers, useCallback, default export) plus typed-contract factories', () => {
  const src = [
    'const o = { m() { return 1; }, p: function () { return 2; } };',
    'export default function () { return null; }',
    'const C = () => { const cb = useCallback(() => {}, []); return <a onClick={() => go()} />; };',
    'function f(this: Window, a: number) { return a; }',
    "const reduce = defineDomain('reduce', ({ s }) => s);",
  ].join('\n');
  assert.deepEqual(functionComplexity(src).map((f) => f.name), ['m', 'p', 'default', 'C', 'cb', 'on:onClick', 'f', 'reduce']);
  assert.equal(functionComplexity(src).find((f) => f.name === 'f').params, 1, 'a TypeScript this parameter is not a parameter');
});

test('functionComplexity: reuses a given parse, and an empty file has no functions', () => {
  const src = 'function a(x) { return x ? 1 : 2; }';
  assert.deepEqual(functionComplexity(src, { ast: parseToAst(src) }).map((f) => f.cyclomatic), [2]);
  assert.deepEqual(functionComplexity('const a = 1;'), []);
});

test('fallow: cognitive comes from fallow\'s per-function results, matched by file + start line (and name on a shared line)', () => {
  // Shape-tolerant: any object with a file, a start line and a cognitive number is one function.
  const report = { files: [{ path: './src/sample.tsx', functions: [{ name: 'loops', line: 12, cognitive: 4, cyclomatic: 4 }, { name: 'deep', line: 56, cognitive_complexity: 7 }] }, { file: 'other.ts', line: 1, cognitive: 9 }] };
  const byFile = fallowFunctions(report);
  assert.deepEqual([...byFile.keys()], ['src/sample.tsx', 'other.ts']);
  assert.deepEqual(byFile.get('src/sample.tsx')[0], { line: 12, name: 'loops', cognitive: 4, cyclomatic: 4 });
  const got = functionComplexity(SOURCE, { fallow: byFile.get('src/sample.tsx') });
  assert.equal(got.find((f) => f.name === 'loops').cognitive, 4);
  assert.equal(got.find((f) => f.name === 'deep').cognitive, 7);
  assert.equal(got.find((f) => f.name === 'flat').cognitive, null, 'a function fallow did not report stays null');
  const shared = functionComplexity('const a = () => 1, b = () => 2;', { fallow: [{ line: 1, name: 'b', cognitive: 3, cyclomatic: null }] });
  assert.deepEqual(shared.map((f) => [f.name, f.cognitive]), [['a', null], ['b', 3]]);
});

test('fileCyclomatic: 1 + the decisions of every function in the file', () => {
  assert.equal(fileCyclomatic('const a = 1;'), 1);
  assert.equal(fileCyclomatic(SOURCE), functionComplexity(SOURCE).reduce((s, f) => s + f.cyclomatic - 1, 0) + 1);
});

test('complexityByName: the first function of each name, anonymous ones skipped', () => {
  const map = complexityByName(SOURCE);
  assert.deepEqual(map.get('loops'), { cyclomatic: 4, cognitive: null, maxNesting: 2, params: 1, returns: 1 });
  assert.equal(map.size, Object.keys(EXPECTED).length);
});
