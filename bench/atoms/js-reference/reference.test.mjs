// The JavaScript reference input, checked three ways:
//   1. every function returns or throws what Node recorded in expected.json (nondeterministic entries by kind only);
//   2. every reference.json entry has a function in map.json, and that function exists;
//   3. a Babel walk finds every syntax.json node predicate in input/syntax.mjs or input/sloppy.cjs.
//
//   node --test bench/atoms/js-reference/reference.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from '@babel/parser';
import { is } from '@babel/types';
import { runAll } from './run.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (file) => JSON.parse(readFileSync(join(here, file), 'utf8'));
const reference = read('reference.json');
const { map } = read('map.json');
const expected = read('expected.json');
const syntax = read('syntax.json');

test('every function matches expected.json', async () => {
  const results = await runAll();
  assert.deepEqual(Object.keys(results).sort(), Object.keys(expected.results).sort(), 'same entries as expected.json');
  const wrong = Object.keys(results).filter((k) => JSON.stringify(results[k]) !== JSON.stringify(expected.results[k]));
  assert.deepEqual(wrong.map((k) => ({ key: k, got: results[k], expected: expected.results[k] })), [], `${wrong.length} outcomes differ from expected.json (recorded on Node ${expected.node}, running ${process.version})`);
});

test('every reference.json entry has a function in map.json', async () => {
  const missing = reference.entries.filter((e) => !map[e.key]?.file || !map[e.key]?.fn).map((e) => e.key);
  assert.deepEqual(missing, [], 'entries without a function');
  const modules = new Map();
  const absent = [];
  for (const e of reference.entries) {
    const { file, fn } = map[e.key];
    if (!modules.has(file)) modules.set(file, await import(pathToFileURL(join(here, 'input', file)).href));
    if (typeof modules.get(file)[fn] !== 'function') absent.push(`${e.key} -> ${file}#${fn}`);
  }
  assert.deepEqual(absent, [], 'map.json names a function its file does not export');
});

// ---- syntax coverage ----

// Walk every node with its parent and the field it sits in.
function walk(node, visit, parent = null, field = null, fns = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent, field, fns);
  const inner = is('Function', node) ? [...fns, node] : fns;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'extra' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue;
    if (Array.isArray(v)) for (const c of v) walk(c, visit, node, k, inner);
    else if (v && typeof v === 'object') walk(v, visit, node, k, inner);
  }
}

// Names a function declares itself (parameters and variables), not counting functions nested in it.
const declared = new WeakMap();
function ownNames(fn) {
  if (!declared.has(fn)) {
    const names = new Set();
    const collect = (node) => {
      if (!node || typeof node.type !== 'string') return;
      if (node !== fn && is('Function', node)) { if (node.type === 'FunctionDeclaration') names.add(node.id.name); return; }
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') names.add(node.id.name);
      for (const [k, v] of Object.entries(node)) if (k !== 'loc' && k !== 'extra') (Array.isArray(v) ? v : [v]).forEach((c) => c && typeof c === 'object' && collect(c));
    };
    for (const p of fn.params) if (p.type === 'Identifier') names.add(p.name);
    collect(fn.body);
    declared.set(fn, names);
  }
  return declared.get(fn);
}

// Statements that end in a semicolon when one is written.
const SEMICOLON = new Set(['ExpressionStatement', 'VariableDeclaration', 'ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement', 'DebuggerStatement']);

const JUMPS = new Set(['BreakStatement', 'ReturnStatement', 'ThrowStatement', 'ContinueStatement']);
const oneOf = (want, got) => (Array.isArray(want) ? want.includes(got) : want === got);
const pattern = (want, got) => typeof got === 'string' && new RegExp(want).test(got);

// What one field of a syntax.json predicate means for a node. `ctx` = { parent, field, fns, source }.
function fieldMatches(name, want, node, ctx) {
  switch (name) {
    case 'type': return (Array.isArray(want) ? want : [want]).some((t) => typeMatches(t, node, ctx));
    case 'raw': return pattern(want, node.extra?.raw);
    // 'dup-named': the same group name in two alternatives, (?<year>…)|(?<year>…).
    case 'pattern': if (want === 'dup-named') { const names = [...(node.pattern ?? '').matchAll(/\(\?<([A-Za-z_$][\w$]*)>/g)].map((m) => m[1]); return names.length > new Set(names).size; } // falls through
    case 'flags': return pattern(want, node[name]);
    case 'hole': return node.elements.includes(null) === want;
    case 'keyName': return !node.computed && (node.key.name ?? node.key.value) === want;
    case 'parent': return oneOf(want, ctx.parent?.type);
    case 'leftType': return oneOf(want, node.left?.type);
    case 'calleeType': return oneOf(want, node.callee?.type);
    case 'meta': return node.meta?.name === want;
    case 'named': return Boolean(node.id) === want;
    case 'inParams': return (ctx.field === 'params') === want;
    case 'keyText': return ctx.source.slice(node.key.start, node.key.end) === want;
    case 'trailingComma': {
      const last = node.params?.at(-1);
      if (!last) return !want;
      const close = ctx.source.indexOf(')', last.end);
      return ctx.source.slice(last.end, close).includes(',') === want;
    }
    case 'expression': return (node.body?.type !== 'BlockStatement') === want;
    case 'superClass': case 'alternate': case 'label': case 'handler': case 'finalizer': case 'param':
      return Boolean(node[name]) === want;
    case 'fallsThrough': {
      const cases = ctx.parent.cases;
      const isLast = cases.at(-1) === node;
      const falls = !isLast && !JUMPS.has(node.consequent.at(-1)?.type) && !(node.consequent.at(-1)?.type === 'BlockStatement' && JUMPS.has(node.consequent.at(-1).body.at(-1)?.type));
      return falls === want;
    }
    case 'renamed': return ((node.local?.name ?? node.local?.value) !== (node.exported?.name ?? node.exported?.value)) === want;
    case 'attributes': return (node.attributes?.length > 0) === want;
    case 'topLevel': return (ctx.fns.length === 0) === want;
    case 'nonAscii': return /[^\x00-\x7f]/.test(node.name) === want;
    default: return oneOf(want, node[name]);
  }
}

// Babel node types, plus the few syntax.json types that are a property of the code rather than one node.
function typeMatches(type, node, ctx) {
  switch (type) {
    // Babel drops the parentheses (createParenthesizedExpressions would also change every callee and parent).
    case 'ParenthesizedExpression': return Boolean(node.extra?.parenthesized);
    // A function using a name that an enclosing function declares.
    case 'Closure': return node.type === 'Identifier' && ctx.fns.length >= 2 && !ownNames(ctx.fns.at(-1)).has(node.name) && ctx.fns.slice(0, -1).some((f) => ownNames(f).has(node.name));
    // A statement that would end in ';' but was written without one.
    case 'ASI': return SEMICOLON.has(node.type) && !(ctx.parent?.type?.startsWith('For') && ctx.field !== 'body') && !ctx.source.slice(node.start, node.end).trimEnd().endsWith(';');
    default: return is(type, node);
  }
}

// A predicate field listing several values (operators + - * / %) needs each value found, not just one of them.
function variants(predicate) {
  const listed = Object.entries(predicate).filter(([k, v]) => Array.isArray(v) && k !== 'type' && k !== 'calleeType' && k !== 'leftType');
  if (!listed.length) return [predicate];
  return listed.flatMap(([k, values]) => values.map((v) => ({ ...predicate, [k]: v })));
}

const sources = ['syntax.mjs', 'sloppy.cjs'].map((file) => {
  const source = readFileSync(join(here, 'input', file), 'utf8');
  const ast = parse(source, {
    sourceType: file.endsWith('.cjs') ? 'script' : 'module',
    // `using`, import attributes (with { type: 'json' }) and v-flag regexes. Babel 8 also parses them by default;
    // listing them keeps the walk working on a parser that does not.
    plugins: ['explicitResourceManagement', 'importAttributes', 'regexpUnicodeSets'],
  });
  const nodes = [];
  walk(ast.program, (node, parent, field, fns) => nodes.push({ node, ctx: { parent, field, fns, source } }));
  for (const comment of ast.comments) nodes.push({ node: comment, ctx: { parent: null, field: 'comments', fns: [], source } });
  return { file, nodes };
});

test('Babel finds every syntax.json node in syntax.mjs / sloppy.cjs', () => {
  const notFound = [];
  for (const entry of syntax.entries) {
    for (const v of variants(entry.node)) {
      const found = sources.some(({ nodes }) => nodes.some(({ node, ctx }) => Object.entries(v).every(([k, want]) => {
        try { return fieldMatches(k, want, node, ctx); } catch { return false; }
      })));
      if (!found) notFound.push(`${entry.id}: ${JSON.stringify(v)}`);
    }
  }
  assert.deepEqual(notFound, [], 'syntax predicates with no matching node');
});
