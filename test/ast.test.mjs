// Tests for the shared AST package's public entry point (src/ast/index.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ast from '../src/ast/index.mjs';
import * as parser from '../src/parser.mjs';

test('public entry point exposes the documented API', () => {
  const names = ['parseToAst', 'parseTsSource', 'walkAst', 'walkForUsage', 'collectCalls', 'collectBareIdentifierUsages',
    'collectControlFlowNodes', 'isNonUsagePosition', 'extractImports', 'extractExports', 'extractJsdoc',
    'staticImportEntries', 'lineOf', 'ts', 'findNode', 'findAllNodes', 'printNode'];
  for (const n of names) assert.ok(ast[n] !== undefined, `missing export ${n}`);
});

test('src/parser.mjs re-exports are the very same functions', () => {
  for (const n of ['parseToAst', 'extractImports', 'extractExports', 'extractJsdoc', 'lineOf']) {
    assert.equal(parser[n], ast[n]);
  }
});

test('collectCalls / collectBareIdentifierUsages ignore comments, strings and property names', () => {
  const src = `// fetch('/c')\nconst s = "fetch(1)";\nconst o = { fetch: 1 };\nobj.fetch;\nfetch('/real');\n`;
  const tree = ast.parseToAst(src);
  const calls = ast.collectCalls(tree, new Set(['fetch']));
  assert.equal(calls.length, 1);
  assert.equal(ast.lineOf(src, calls[0].index), 5);
  assert.equal(ast.collectBareIdentifierUsages(tree, new Set(['fetch'])).length, 1);
});

test('collectControlFlowNodes finds control flow in position order', () => {
  const tree = ast.parseToAst('function f(x){ if (x) { for (const a of x) {} } try {} catch {} }');
  assert.deepEqual(ast.collectControlFlowNodes(tree).map((n) => n.type), ['IfStatement', 'ForOfStatement', 'TryStatement']);
});

test('staticImportEntries excludes dynamic imports; extractImports includes them', () => {
  const src = `import a from './a';\nconst b = () => import('./b');\n`;
  assert.deepEqual(ast.staticImportEntries(ast.parseToAst(src)).map((e) => e.value), ['./a']);
  assert.deepEqual(ast.extractImports(src), ['./a', './b']);
});

test('TypeScript-compiler helpers: parseTsSource + findNode/findAllNodes + printNode', () => {
  const sf = ast.parseTsSource('interface P { a: string; b(): void }\ntype Q = { c: number };');
  assert.ok(ast.findNode(sf, (n) => ast.ts.isInterfaceDeclaration(n) && n.name.text === 'P'));
  assert.equal(ast.findAllNodes(sf, (n) => ast.ts.isPropertySignature(n) || ast.ts.isMethodSignature(n)).length, 3);
  const node = ast.ts.factory.createVariableStatement(undefined, ast.ts.factory.createVariableDeclarationList(
    [ast.ts.factory.createVariableDeclaration('x', undefined, undefined, ast.ts.factory.createNumericLiteral(1))],
    ast.ts.NodeFlags.Const));
  assert.equal(ast.printNode(node), 'const x = 1;');
});
