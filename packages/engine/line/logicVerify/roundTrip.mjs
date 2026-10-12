// Line logic verification, step 3: the ROUND-TRIP check for extraction (docs/line/HANDOVER-2026-10-12-import.md, C,
// "Round-trip check for extraction"). Re-inline what the step extracted into the unit's call sites, then run the C1
// canonical compare (canonical.mjs) against the original unit. A unit that lands in no atom or block is not-extracted.
//
// What re-inlines (anything else answers cant-tell, never a guess):
//   - a call `g(args)` in the after unit whose callee is free there and is NEW: the before file binds no `g`;
//   - `g` resolves in the after tree, in the same file or through a relative import, to a function whose body is one
//     expression (`(a, b) => e` or `{ return e; }`), with plain identifier parameters, not async or a generator, and
//     no `this` or `arguments`;
//   - every argument is side-effect free (an identifier, a literal, a template with no expressions), so substituting
//     it for its parameter cannot reorder, repeat or drop an effect;
//   - no free name in `e` is captured by a local of the call site.
// The inlined text is `(e[params := (args)])`; esbuild drops the extra parentheses when printing the canonical form.
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseToAst } from '@construct/ast';
import { canonicalUnit, canonicalCompare } from './canonical.mjs';

/** @typedef {import('./contract.mjs').LayerResult} LayerResult */
/** @typedef {import('./contract.mjs').UnitRef} UnitRef */
/** @typedef {import('./canonical.mjs').UnitSpec} UnitSpec */

/**
 * An atom or block the step produced, on the after side: a file, or one function in it.
 * @typedef {{file: string, fn?: string}} Block
 */

const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'];
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/**
 * Whether the unit landed in one of the step's atoms or blocks.
 * @param {{file: string, fn: string}} unit
 * @param {Block[]} blocks
 * @returns {boolean}
 */
export const inBlocks = (unit, blocks) => blocks.some((b) => b.file === unit.file && (b.fn === undefined || b.fn === unit.fn));

/** Names a module binds at its top level: declarations and imports. */
function topLevelNames(ast) {
  const names = new Set();
  for (const s of ast.body) {
    const d = s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration' ? s.declaration ?? s : s;
    if (d.type === 'ImportDeclaration') d.specifiers.forEach((x) => names.add(x.local.name));
    else if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) names.add(d.id.name);
    else if (d.type === 'VariableDeclaration') d.declarations.forEach((x) => x.id.type === 'Identifier' && names.add(x.id.name));
  }
  return names;
}

/** Where `name` is defined for code in `file` (app-relative): this file, or a relative import's target. */
function resolveCallee(root, file, ast, name) {
  for (const s of ast.body) {
    if (s.type !== 'ImportDeclaration') continue;
    const spec = s.specifiers.find((x) => x.local.name === name && x.type === 'ImportSpecifier');
    if (!spec || !s.source.value.startsWith('.')) continue;
    const base = path.posix.join(path.posix.dirname(file), s.source.value);
    const hit = EXTS.map((e) => base + e).find((p) => fs.existsSync(path.join(root, p)) && fs.statSync(path.join(root, p)).isFile());
    return hit ? { file: hit, fn: spec.imported.type === 'Identifier' ? spec.imported.name : String(spec.imported.value) } : null;
  }
  return topLevelNames(ast).has(name) ? { file, fn: name } : null;
}

const simpleArg = (a) => a.type === 'Identifier' || a.type === 'Literal' || (a.type === 'TemplateLiteral' && a.expressions.length === 0) || (a.type === 'UnaryExpression' && a.operator === '-' && a.argument.type === 'Literal');

function* walk(node) {
  if (!node || typeof node.type !== 'string') return;
  yield node;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'parent' || k === 'loc' || k === 'range') continue;
    if (Array.isArray(v)) { for (const c of v) yield* walk(c); } else if (v && typeof v === 'object') yield* walk(v);
  }
}

/**
 * The inline text for one call, or a reason it cannot be inlined.
 * @returns {{text: string}|{reason: string}}
 */
function inlineCall(root, target, call, callerLocals, callerSource) {
  const g = canonicalUnit({ root, file: target.file, fn: target.fn });
  if (!g) return { reason: `${target.fn} is not in ${target.file}` };
  const fn = g.node;
  if (!FN_TYPES.has(fn.type) || fn.async || fn.generator) return { reason: `${target.fn} is not a plain function` };
  const body = fn.body.type === 'BlockStatement' ? (fn.body.body.length === 1 && fn.body.body[0].type === 'ReturnStatement' ? fn.body.body[0].argument : null) : fn.body;
  if (!body) return { reason: `${target.fn} is more than one returned expression` };
  if (!fn.params.every((p) => p.type === 'Identifier')) return { reason: `${target.fn} has a parameter that is not a plain name` };
  if (call.arguments.length !== fn.params.length || !call.arguments.every(simpleArg)) return { reason: `the call to ${target.fn} passes an argument that is not a plain name or literal` };
  const params = new Map(fn.params.map((p, i) => [g.renames.get(p), call.arguments[i]]));
  const edits = [];
  for (const n of walk(body)) {
    if (n.type === 'ThisExpression' || (n.type === 'Identifier' && n.name === 'arguments' && !g.renames.has(n))) return { reason: `${target.fn} uses this or arguments` };
    if (n.type !== 'Identifier') continue;
    const canon = g.renames.get(n);
    if (canon !== undefined && params.has(canon)) edits.push({ at: n.range, text: `(${callerSource.slice(...params.get(canon).range)})` });
    else if (canon === undefined && callerLocals.has(n.name)) return { reason: `${target.fn} names ${n.name}, which the call site declares itself` };
  }
  let text = g.source.slice(body.range[0], body.range[1]);
  for (const e of edits.sort((x, y) => y.at[0] - x.at[0])) text = text.slice(0, e.at[0] - body.range[0]) + e.text + text.slice(e.at[1] - body.range[0]);
  return { text: `(${text.includes('`') ? text : text.replace(/\s*\n\s*/g, ' ')})` };
}

/**
 * The round-trip check for one extracted unit: re-inline the new functions it calls, then canonical-compare with the
 * original. Answers as the `round-trip` layer.
 * @param {{beforeRoot: string, afterRoot: string, before: UnitSpec, after: UnitSpec, transforms?: import('./contract.mjs').TransformId[]|null}} args
 * @returns {LayerResult & {inlined?: string[]}}
 */
export function roundTripCompare({ beforeRoot, afterRoot, before, after, transforms = null }) {
  const t0 = performance.now();
  const ms = () => Math.round((performance.now() - t0) * 1000) / 1000;
  const cantTell = (reason) => ({ layer: /** @type {const} */ ('round-trip'), outcome: /** @type {const} */ ('cant-tell'), reason, ms: ms() });
  let afterUnit;
  let beforeNames;
  try {
    afterUnit = canonicalUnit({ root: afterRoot, ...after });
    beforeNames = topLevelNames(parseToAst(fs.readFileSync(path.join(beforeRoot, before.file), 'utf8')));
  } catch (err) {
    return cantTell(`the units could not be read: ${/** @type {Error} */ (err).message}`);
  }
  if (!afterUnit) return cantTell(`${after.fn} is not in ${after.file} after the step`);
  const source = afterUnit.source;
  const ast = parseToAst(source);
  const callerLocals = new Set([...afterUnit.renames.keys()].map((id) => id.name));
  const edits = [];
  const inlined = [];
  for (const n of walk(afterUnit.node)) {
    if (n.type !== 'CallExpression' || n.callee.type !== 'Identifier') continue;
    const name = n.callee.name;
    if (callerLocals.has(name) || beforeNames.has(name)) continue; // a local, or a function the original could call too
    const target = resolveCallee(afterRoot, after.file, ast, name);
    if (!target) continue; // a global
    const r = inlineCall(afterRoot, target, n, callerLocals, source);
    if ('reason' in r) return cantTell(r.reason);
    edits.push({ at: n.range, text: r.text });
    inlined.push(`${target.file}#${target.fn}`);
  }
  let text = source;
  for (const e of edits.sort((x, y) => y.at[0] - x.at[0])) text = text.slice(0, e.at[0]) + e.text + text.slice(e.at[1]);
  const r = canonicalCompare({ root: beforeRoot, ...before }, { ...after, source: text }, { transforms });
  // Nothing re-inlined (an expression extracted to a local, or no new function called): the round-trip has nothing to
  // undo, so a text mismatch here is not a failed extraction; the later layers decide.
  if (!inlined.length && r.outcome === 'changed') return cantTell('no extracted function to re-inline (an expression extracted to a local is not re-inlined), so the later layers decide');
  return { ...r, layer: 'round-trip', ms: ms(), ...(inlined.length ? { inlined } : {}) };
}
