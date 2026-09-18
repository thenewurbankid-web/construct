import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseFile,
  summarizeFeature,
  createSummaryCache,
  classifyLayer,
  extractExports,
  extractImports,
  extractJsdoc,
  estimateComplexity,
} from '../src/parser.mjs';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-parser-'));
}

function writeFile(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

test('classifyLayer recognizes route, and each features/* layer directory', () => {
  assert.equal(classifyLayer('app/dashboard/page.tsx'), 'route');
  assert.equal(classifyLayer('features/x/components/Foo.tsx'), 'component');
  assert.equal(classifyLayer('features/x/hooks/useFoo.ts'), 'hook');
  assert.equal(classifyLayer('features/x/domain/rules.ts'), 'domain');
  assert.equal(classifyLayer('random/file.ts'), null);
});

test('parseFile extracts exports, imports, jsdoc, loc and a basic component summary', () => {
  const root = tmpRoot();
  writeFile(
    root,
    'features/x/components/Card.tsx',
    `import { useMemo } from 'react';\n\n/** Renders a card. */\nexport function Card({ title }) {\n  const upper = useMemo(() => title.toUpperCase(), [title]);\n  return <div>{upper}</div>;\n}\n`
  );
  const summary = parseFile(root, 'features/x/components/Card.tsx');
  assert.equal(summary.path, 'features/x/components/Card.tsx');
  assert.equal(summary.layer, 'component');
  assert.deepEqual(summary.exports, ['Card']);
  assert.deepEqual(summary.imports, ['react']);
  assert.equal(summary.jsdoc, '/** Renders a card. */');
  assert.equal(typeof summary.loc, 'number');
  assert.ok(summary.loc > 0);
});

test('extractExports handles generics on function and class declarations', () => {
  const source = `export function identity<T>(x: T): T {\n  return x;\n}\n\nexport class Box<T> {\n  value: T;\n}\n`;
  const names = extractExports(source).map((e) => e.name);
  assert.deepEqual(names, ['identity', 'Box']);
});

test('extractExports finds the class name for a decorated export, and extractJsdoc correctly associates the JSDoc above the decorator (#19, fixed by AST parsing)', () => {
  // Previously (regex-based parsing): a decorator sitting between a JSDoc block and the
  // declaration it documents broke "immediately preceding" association, because the decorator
  // line (not whitespace) sat between the comment and `export`. AST-based parsing (#88) walks
  // back past leading decorators to find the real declaration boundary, so this now resolves
  // correctly — the same way a human reading the code would associate the comment.
  const source = `/** A component. */\n@Component({ selector: 'app-foo' })\nexport class Foo {}\n`;
  const exported = extractExports(source);
  assert.deepEqual(exported.map((e) => e.name), ['Foo']);
  assert.equal(extractJsdoc(source, exported[0].index), '/** A component. */');
});

test('extractJsdoc does not associate a JSDoc block across an intervening non-JSDoc comment', () => {
  const source = `/** doc */\n// TODO: revisit\nexport function f() {}\n`;
  const exported = extractExports(source);
  assert.equal(extractJsdoc(source, exported[0].index), null);
});

test('extractExports reports every binding from a multi-declarator/destructured export const', () => {
  const source = `export const a = 1, { b, c: renamedC } = obj, [d, ...rest] = arr;\n`;
  const names = extractExports(source).map((e) => e.name);
  assert.deepEqual(names, ['a', 'b', 'renamedC', 'd', 'rest']);
});

test('parseFile handles JSX content without crashing and reports imports/exports', () => {
  const root = tmpRoot();
  writeFile(
    root,
    'features/x/components/Panel.tsx',
    `import React from 'react';\nimport { Button } from './Button';\n\nexport function Panel() {\n  return (\n    <div className="panel">\n      <Button label="Go" />\n    </div>\n  );\n}\n`
  );
  const summary = parseFile(root, 'features/x/components/Panel.tsx');
  assert.deepEqual(summary.exports, ['Panel']);
  assert.deepEqual(summary.imports, ['react', './Button']);
});

test('extractImports follows dynamic import(...) expressions', () => {
  const source = `export async function load() {\n  const mod = await import('./lazy-module.js');\n  return mod;\n}\n`;
  assert.deepEqual(extractImports(source), ['./lazy-module.js']);
});

test('estimateComplexity counts control-flow/logical tokens and bare ternaries, plus 1', () => {
  // Rough heuristic, not real cyclomatic complexity: '?.' and '??' are deliberately excluded
  // so optional chaining / nullish coalescing (common in modern TS) doesn't inflate the count.
  const flat = `export function f() { return 1; }`;
  assert.equal(estimateComplexity(flat), 1);
  const branchy = `export function g(a, b) {\n  if (a && b) {\n    return a ? b : a;\n  }\n  return a?.b ?? b;\n}\n`;
  // if(+1) && (+1) ternary ? (+1) => 3 + base 1 = 4; the ?. and ?? are excluded.
  assert.equal(estimateComplexity(branchy), 4);
});

test('extractExports handles export lists with aliasing', () => {
  const source = `const a = 1;\nfunction b() {}\nexport { a, b as renamedB };\n`;
  const names = extractExports(source).map((e) => e.name);
  assert.deepEqual(names, ['a', 'renamedB']);
});

test('extractExports handles wildcard re-exports (export * from / export type * from)', () => {
  const source = `export type * from './types';\nexport * from './controllers/WidgetController';\n`;
  const names = extractExports(source).map((e) => e.name);
  assert.deepEqual(names, ['./types', './controllers/WidgetController']);
});

test('extractExports handles a namespaced wildcard re-export (export * as ns from)', () => {
  const source = `export * as widget from './widget-internal';\n`;
  const names = extractExports(source).map((e) => e.name);
  assert.deepEqual(names, ['widget']);
});

test('summarizeFeature aggregates files, derives publicApi from index.ts, sums loc', () => {
  const root = tmpRoot();
  writeFile(root, 'features/checkout/index.ts', `export { initCheckout } from './workflows/initCheckout';\n`);
  writeFile(root, 'features/checkout/workflows/initCheckout.ts', `export function initCheckout() {\n  return true;\n}\n`);
  writeFile(root, 'features/checkout/components/Summary.tsx', `export function Summary() {\n  return <div />;\n}\n`);

  const summary = summarizeFeature(root, 'checkout');
  assert.equal(summary.feature, 'checkout');
  assert.deepEqual(summary.publicApi, ['initCheckout']);
  assert.ok(Array.isArray(summary.layers.workflow));
  assert.ok(Array.isArray(summary.layers.component));
  assert.equal(summary.layers.workflow.length, 1);
  assert.equal(summary.layers.component.length, 1);
  const expectedLoc = summary.layers.workflow[0].loc + summary.layers.component[0].loc + summary.loc - summary.layers.workflow[0].loc - summary.layers.component[0].loc;
  assert.ok(summary.loc >= summary.layers.workflow[0].loc + summary.layers.component[0].loc);
});

test('createSummaryCache returns a cached Summary while mtime is unchanged, and re-parses after a change', async () => {
  const root = tmpRoot();
  const abs = writeFile(root, 'features/x/domain/rules.ts', `export function rule() {\n  return true;\n}\n`);
  const cache = createSummaryCache();
  const first = cache.get(root, 'features/x/domain/rules.ts');
  const second = cache.get(root, 'features/x/domain/rules.ts');
  assert.equal(first, second, 'unchanged file should hit the cache (same object reference)');

  // Force a distinct mtime, then change content.
  await new Promise((r) => setTimeout(r, 10));
  fs.writeFileSync(abs, `export function rule() {\n  return false;\n}\nexport function extra() {}\n`);
  const futureTime = new Date(Date.now() + 5000);
  fs.utimesSync(abs, futureTime, futureTime);
  const third = cache.get(root, 'features/x/domain/rules.ts');
  assert.notEqual(third, first, 'changed mtime should force re-parse');
  assert.deepEqual(third.exports, ['rule', 'extra']);
});
