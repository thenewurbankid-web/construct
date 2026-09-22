// Tests for the shared AST package's public entry point (packages/ast/index.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ast from '../packages/ast/index.mjs';
import * as parser from '../packages/core/parser.mjs';

test('public entry point exposes the documented API', () => {
  const names = ['parseToAst', 'parseTsSource', 'walkAst', 'walkForUsage', 'collectCalls', 'collectBareIdentifierUsages',
    'collectControlFlowNodes', 'isNonUsagePosition', 'extractImports', 'extractExports', 'extractJsdoc',
    'staticImportEntries', 'lineOf', 'ts', 'findNode', 'findAllNodes', 'printNode',
    'collectInlineJsxLogic', 'computeJsxComplexity'];
  for (const n of names) assert.ok(ast[n] !== undefined, `missing export ${n}`);
});

test('packages/core/parser.mjs re-exports are the very same functions', () => {
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

// #508 -- jsxComplexity.mjs (COMPONENT-005/006's shape detector).
test('collectInlineJsxLogic finds a JSX-producing ternary, &&, and .map() render, in position order', () => {
  const src = `function C(p) {
  return <div>{p.a ? <X/> : <Y/>}{p.b && <Z/>}{p.items.map(i => <li key={i}>{i}</li>)}</div>;
}`;
  const hits = ast.collectInlineJsxLogic(ast.parseToAst(src));
  assert.deepEqual(hits.map((h) => h.kind), ['conditional', 'conditional', 'loop']);
  // sorted by position.
  assert.ok(hits[0].node.range[0] < hits[1].node.range[0]);
  assert.ok(hits[1].node.range[0] < hits[2].node.range[0]);
});

test('collectInlineJsxLogic ignores a ternary/&&/.map that never produces JSX', () => {
  const src = `function f(p) {
  const label = p.ok ? 'yes' : 'no';
  const enabled = p.a && p.b;
  const ids = p.items.map(i => i.id);
  return label + String(enabled) + String(ids.length);
}`;
  assert.deepEqual(ast.collectInlineJsxLogic(ast.parseToAst(src)), []);
});

test('collectInlineJsxLogic catches a .map() whose callback returns JSX from a block body (not just a concise arrow body)', () => {
  const src = `function C(p) {
  return <ul>{p.items.map((i) => { return <li key={i}>{i}</li>; })}</ul>;
}`;
  assert.deepEqual(ast.collectInlineJsxLogic(ast.parseToAst(src)).map((h) => h.kind), ['loop']);
});

test('computeJsxComplexity reports JSX nesting depth and inline-branch count independently', () => {
  const flat = ast.computeJsxComplexity(ast.parseToAst('function C(){ return <div><span/></div>; }'));
  assert.deepEqual(flat, { maxDepth: 2, branchCount: 0 });

  const branchy = ast.computeJsxComplexity(ast.parseToAst('function C(p){ return <div>{p.a && <X/>}{p.b && <Y/>}</div>; }'));
  assert.equal(branchy.branchCount, 2);
  assert.equal(branchy.maxDepth, 2); // outer <div> + each conditionally-rendered element

  const deep = ast.computeJsxComplexity(ast.parseToAst('function C(){ return <a><b><c/></b></a>; }'));
  assert.equal(deep.maxDepth, 3);
  assert.equal(deep.branchCount, 0);
});
