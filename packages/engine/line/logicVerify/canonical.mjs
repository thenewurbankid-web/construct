// Line logic verification, step 3: the C1 CANONICALISER and the L0 canonical compare (docs/line/HANDOVER-2026-10-12-import.md,
// "Line logic verification", C1). One logic unit (a function, or an expression the logic map anchors) becomes one
// stable string and hash; two units with the same string behave the same for every input (a proof layer).
//
// How the canonical form is made, in order:
//   1. Parse the file with the logic map's parse (@construct/ast parseToAst, typescript-estree) and find the unit with the
//      logic map's own locator: logicMap.functionName names functions, fileUnits' start offset places expression units.
//   2. Mangle locals only, scope-precisely: every variable DECLARED inside the unit (params, let/const/var, inner
//      functions and classes, catch params) is renamed by its order of first appearance ($$0, $$1, ...), and the unit's
//      own name (with its recursive references) becomes $$self. Free names (imports, module-level functions, globals)
//      and property names stay as they are, so a call to another function still has to name the same function.
//      Scopes come from @typescript-eslint/scope-manager, the analyser ESLint runs over this same AST.
//   3. Print with ONE pinned minifier, esbuild (PINNED below), conservative settings: whitespace and comments only,
//      no syntax minification (no inlining, constant folding or reordering, so side effects keep their order and
//      function boundaries stay), types erased by its TS loader.
//   4. Hash with the logic map's fingerprint (logicMap.unitFingerprint), kind + `$$self` + the pinned printer + text.
//      There is no second fingerprint scheme: the canonical hash is a logic-map fingerprint of the canonical text.
//
// Why esbuild's own identifier mangler is not used for step 2: it picks short names by character frequency of the
// whole input, the old local names included, so renaming `items` to `xs` changes the mangled names (measured on
// esbuild 0.28.2). Renaming by first appearance first is what makes the form rename-stable.
//
// Choices (each conservative: a false "changed" falls through to the next layer on a hand edit, a false "same" would
// be unsound):
//   comments, formatting, quotes, parentheses, type annotations, `as`/`!`/`satisfies`   ignored
//   a renamed local, a renamed unit, a moved file (the path is never in the form)        equal
//   reordered declarations, even independent ones                                         NOT equal: proving
//     independence needs effect analysis, and the minifier never reorders, so this layer stays a pure text proof
//   an arrow function vs a function declaration                                           NOT equal: they differ in
//     `this`, `arguments`, hoisting and `new`
//   `x => e` vs `x => { return e; }`                                                      NOT equal (no syntax
//     minification); the later layers decide on a hand edit
//   export status (`export function` vs `function`)                                      not part of the unit; the
//     logic map's export units cover it
//
// Mismatch location: both units' ASTs are walked side by side under the same renaming; the first difference gives
// the contract's VerdictLocation {astPath, file, line, column, side}. A statement that exists only before is reported
// on the before side (side 'before'); everything else on the after side.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { parseToAst } from '@construct/ast';
import { functionName, unitFingerprint, fileUnits } from '../logicMap.mjs';

/** @typedef {import('./contract.mjs').LayerResult} LayerResult */
/** @typedef {import('./contract.mjs').VerdictLocation} VerdictLocation */
/** @typedef {import('./contract.mjs').TransformId} TransformId */

const require = createRequire(import.meta.url);

/** The one pinned printer and its settings. The version is part of every hash, so forms from two versions never match. */
export const PINNED = Object.freeze({
  minifier: 'esbuild',
  version: '0.28.2',
  options: Object.freeze({
    minifyWhitespace: true, minifySyntax: false, minifyIdentifiers: false, keepNames: false,
    legalComments: 'none', target: 'esnext', charset: 'utf8',
    tsconfigRaw: { compilerOptions: { useDefineForClassFields: true, experimentalDecorators: false, verbatimModuleSyntax: false } },
  }),
});

/** The name the unit's own binding gets, and the prefix of mangled locals. */
export const SELF = '$$self';
const LOCAL = (/** @type {number} */ i) => `$$${i}`;

const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const TS_WRAPPERS = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSInstantiationExpression']);
/** Keys that are not behaviour: positions, comments, raw text, types and TS-only modifiers (esbuild erases them). */
const SKIP_KEYS = new Set(['type', 'range', 'loc', 'parent', 'raw', 'comments', 'tokens', 'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'decorators', 'declare', 'accessibility', 'definite', 'override', 'readonly', 'abstract', 'optional', 'importKind', 'exportKind']);
const LEAVES = new Set(['Identifier', 'JSXIdentifier', 'PrivateIdentifier', 'Literal', 'TemplateElement', 'JSXText']);

let esbuildCache;
/** The pinned esbuild, or null when it cannot be loaded (the compare then answers cant-tell). */
function esbuild() {
  if (esbuildCache === undefined) {
    try { esbuildCache = require('esbuild'); } catch { esbuildCache = null; }
  }
  return esbuildCache;
}
let scopeCache;
function scopeManager() {
  if (scopeCache === undefined) {
    try { scopeCache = require('@typescript-eslint/scope-manager'); } catch { scopeCache = null; }
  }
  return scopeCache;
}

/**
 * Where to find a unit. `source` replaces reading `root`/`file` from disk. `line` + `kind` pick an expression unit the
 * logic map anchors inside `fn` (a branch, a toast call ...); without them the unit is the function named `fn`.
 * @typedef {{file: string, fn: string, root?: string, source?: string, line?: number, kind?: string}} UnitSpec
 */

/**
 * One canonicalised unit.
 * @typedef {object} CanonicalUnit
 * @property {string} file
 * @property {string} fn
 * @property {string} text   The canonical form (esbuild output of the renamed unit).
 * @property {string} hash   logicMap.unitFingerprint of the canonical text, 16 hex characters.
 * @property {any} node      The unit's ESTree node in its file.
 * @property {Map<any, string>} renames  Identifier node -> canonical name.
 * @property {string} source The file's source.
 */

const readSource = (/** @type {UnitSpec} */ spec) => spec.source ?? fs.readFileSync(path.join(spec.root ?? '.', spec.file), 'utf8');

/** Every node with its parent and grandparent, pre-order. */
function* nodes(node, parent = null, grand = null) {
  if (!node || typeof node.type !== 'string') return;
  yield { node, parent, grand };
  for (const [k, v] of Object.entries(node)) {
    if (k === 'parent' || k === 'loc' || k === 'range') continue;
    if (Array.isArray(v)) { for (const c of v) yield* nodes(c, node, parent); } else if (v && typeof v === 'object') yield* nodes(v, node, parent);
  }
}

/**
 * Find a unit's node in a parsed file: the outermost function the logic map names `fn` (logicMap.functionName), or a
 * `const fn = <expression>`; with `line` + `kind`, the logic-map unit of that kind at that line inside `fn`.
 * @param {any} ast
 * @param {string} source
 * @param {UnitSpec} spec
 * @returns {{node: any, parent: any, frame: 'declaration'|'value'|'method'|'expression', selfNode: any}|null}
 */
export function locateUnit(ast, source, spec) {
  if (spec.line !== undefined && spec.kind && spec.kind !== 'export') {
    const u = fileUnits(source, spec.file).find((x) => x.fn === spec.fn && x.kind === spec.kind && x.line === spec.line);
    if (!u) return null;
    let best = null;
    for (const { node } of nodes(ast)) {
      if (node.range?.[0] !== u.start || node.type === 'ExpressionStatement' || node.type === 'VariableDeclaration') continue;
      if (!best || node.range[1] > best.range[1]) best = node;
    }
    return best ? { node: best, parent: null, frame: 'expression', selfNode: null } : null;
  }
  for (const { node, parent, grand } of nodes(ast)) {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === spec.fn && node.init && !FN_TYPES.has(node.init.type)) {
      const init = unwrap(node.init);
      if (!FN_TYPES.has(init.type) && !(init.type === 'CallExpression' && /^use(Callback|Memo)$/.test(init.callee?.name ?? ''))) return { node: node.init, parent: node, frame: 'value', selfNode: node.id };
    }
    if (!FN_TYPES.has(node.type) || functionName(node, parent, grand) !== spec.fn) continue;
    if (node.type === 'FunctionDeclaration') return { node, parent, frame: 'declaration', selfNode: node.id };
    if (parent?.type === 'MethodDefinition' || (parent?.type === 'Property' && (parent.method || parent.kind !== 'init'))) return { node, parent, frame: 'method', selfNode: null };
    const declarator = parent?.type === 'VariableDeclarator' ? parent : grand?.type === 'VariableDeclarator' ? grand : null;
    return { node, parent, frame: 'value', selfNode: declarator?.id ?? node.id ?? null };
  }
  return null;
}

/**
 * The names of every function unit in a file, outermost first (the names locateUnit finds).
 * @param {string} source
 * @returns {string[]}
 */
export function unitNames(source) {
  const out = new Set();
  for (const { node, parent, grand } of nodes(parseToAst(source))) {
    const name = FN_TYPES.has(node.type) ? functionName(node, parent, grand) : null;
    if (name && !name.startsWith('on:')) out.add(name);
  }
  return [...out];
}

const unwrap = (n) => { let x = n; while (x && TS_WRAPPERS.has(x.type)) x = x.expression; return x; };
const within = (n, outer) => n.range[0] >= outer.range[0] && n.range[1] <= outer.range[1];

/**
 * Scope-precise local renaming: every value variable declared inside the unit gets $$<k> by first appearance; the
 * unit's own binding gets $$self. Returns Identifier node -> new name.
 * @param {any} ast
 * @param {any} unitNode
 * @param {any} selfNode
 * @param {boolean} jsx
 * @returns {Map<any, string>}
 */
function localRenames(ast, unitNode, selfNode, jsx) {
  const sm = scopeManager();
  if (!sm) throw new Error('@typescript-eslint/scope-manager is not installed');
  const manager = sm.analyze(ast, { sourceType: 'module', jsxPragma: jsx ? 'React' : null, lib: ['esnext', 'dom'] });
  /** @type {{first: number, ids: any[], self: boolean}[]} */
  const vars = [];
  const seen = new Set();
  for (const scope of manager.scopes) {
    for (const v of scope.variables) {
      if (seen.has(v) || (v.isTypeVariable && !v.isValueVariable)) continue;
      seen.add(v);
      const self = selfNode !== null && v.identifiers.includes(selfNode);
      const declaredInside = v.identifiers.length > 0 && v.identifiers.every((id) => within(id, unitNode));
      if (!self && !declaredInside) continue;
      const ids = [...v.identifiers, ...v.references.map((r) => r.identifier)].filter((id) => within(id, unitNode) || id === selfNode);
      if (!ids.length) continue;
      vars.push({ first: Math.min(...ids.map((id) => id.range[0])), ids, self });
    }
  }
  /** @type {Map<any, string>} */
  const out = new Map();
  let k = 0;
  for (const v of vars.sort((a, b) => a.first - b.first)) {
    const name = v.self ? SELF : LOCAL(k++);
    for (const id of v.ids) out.set(id, name);
  }
  return out;
}

/** The unit's source with the renames spliced in (shorthand properties are expanded so their keys stay). */
function renamedText(source, unitNode, renames, parents) {
  const edits = [];
  for (const [id, name] of renames) {
    if (!within(id, unitNode)) continue;
    const p = parents.get(id);
    const shorthand = p?.type === 'Property' && p.shorthand && (p.value === id || (p.value?.type === 'AssignmentPattern' && p.value.left === id));
    edits.push({ at: id.range, text: shorthand ? `${id.name}: ${name}` : name });
  }
  edits.sort((a, b) => b.at[0] - a.at[0]);
  let text = source.slice(unitNode.range[0], unitNode.range[1]);
  const base = unitNode.range[0];
  let last = Infinity;
  for (const e of edits) {
    if (e.at[1] > last) continue; // the same node twice (a shorthand key and value share a range)
    text = text.slice(0, e.at[0] - base) + e.text + text.slice(e.at[1] - base);
    last = e.at[0];
  }
  return text;
}

/** Frame the renamed unit text as one statement esbuild can print. */
function framed(text, loc) {
  if (loc.frame === 'declaration') return text;
  if (loc.frame === 'method') {
    const fn = loc.node;
    const kind = loc.parent.kind === 'get' || loc.parent.kind === 'set' ? `${loc.parent.kind} ` : '';
    return `({${kind}${fn.async ? 'async ' : ''}${fn.generator ? '*' : ''}${SELF}${text}});`;
  }
  return `const ${SELF} = (${text});`;
}

/**
 * Canonicalise one unit.
 * @param {UnitSpec} spec
 * @returns {CanonicalUnit|null} null when the file has no such unit.
 */
export function canonicalUnit(spec) {
  const source = readSource(spec);
  const ast = parseToAst(source);
  const loc = locateUnit(ast, source, spec);
  if (!loc) return null;
  const jsx = /\.[jt]sx$/.test(spec.file);
  const renames = localRenames(ast, loc.node, loc.selfNode, jsx);
  const parents = new Map();
  for (const { node, parent } of nodes(loc.node)) parents.set(node, parent);
  if (loc.parent) parents.set(loc.node, loc.parent);
  const eb = esbuild();
  if (!eb) throw new Error('esbuild is not installed');
  const input = framed(renamedText(source, loc.node, renames, parents), loc);
  const text = eb.transformSync(input, { ...PINNED.options, loader: jsx ? 'tsx' : 'ts' }).code.trim();
  const hash = unitFingerprint(/** @type {any} */ (spec.kind ?? 'export'), SELF, `${PINNED.minifier}@${eb.version}\u0000${text}`);
  return { file: spec.file, fn: spec.fn, text, hash, node: loc.node, renames, source };
}

// ---------------------------------------------------------------------------------------------
// Where two units differ: a side-by-side walk under the same renaming.

const leafKey = (n, ren) => {
  if (n.type === 'Identifier' || n.type === 'JSXIdentifier' || n.type === 'PrivateIdentifier') return `${n.type}:${ren.get(n) ?? n.name}`;
  if (n.type === 'Literal') return `L:${JSON.stringify(n.regex ? `/${n.regex.pattern}/${n.regex.flags}` : n.bigint ?? n.value)}`;
  if (n.type === 'TemplateElement') return `T:${JSON.stringify(n.value?.cooked)}`;
  return `X:${JSON.stringify(n.value.replace(/\s+/g, ' ').trim())}`;
};
const emptyish = (v) => v === undefined || v === null || v === false || (Array.isArray(v) && v.length === 0);
const keysOf = (n) => Object.keys(n).filter((k) => !SKIP_KEYS.has(k));
/** Where a child value starts in the source (primitives first), so the walk reports the first difference in reading order. */
const startOf = (v) => {
  const n = Array.isArray(v) ? v.find((x) => x?.range) : v;
  return n && typeof n === 'object' && n.range ? n.range[0] : -1;
};

/**
 * The first difference between two subtrees, or null when they are the same under the renamings.
 * @returns {{segs: string[], a: any, b: any, side?: 'before'|'after'}|null}
 */
function firstDiff(a0, b0, segs, A, B, pa = null, pb = null) {
  const a = unwrap(a0);
  const b = unwrap(b0);
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a ?? null) === (b ?? null) ? null : { segs, a: a ?? pa, b: b ?? pb, side: b ? 'after' : 'before' };
  }
  if (a.type !== b.type) return { segs, a, b };
  if (LEAVES.has(a.type)) return leafKey(a, A) === leafKey(b, B) ? null : { segs, a, b };
  const keys = [...new Set([...keysOf(a), ...keysOf(b)])].sort((x, y) => startOf(b[x] ?? a[x]) - startOf(b[y] ?? a[y]));
  for (const key of keys) {
    const va = a[key];
    const vb = b[key];
    const seg = `${a.type}.${key}`;
    if (Array.isArray(va) || Array.isArray(vb)) {
      const xa = Array.isArray(va) ? va : [];
      const xb = Array.isArray(vb) ? vb : [];
      const eq = (x, y) => firstDiff(x, y, [], A, B) === null;
      const n = Math.min(xa.length, xb.length);
      let i = 0;
      while (i < n && eq(xa[i], xb[i])) i++;
      if (i === xa.length && i === xb.length) continue;
      const extra = xa.length - xb.length;
      if (extra > 0 && xa.slice(i + extra).every((x, k) => eq(x, xb[i + k]))) return { segs: [...segs, `${seg}[${i}]`], a: xa[i], b, side: 'before' };
      if (extra < 0 && xb.slice(i - extra).every((y, k) => eq(xa[i + k], y))) return { segs: [...segs, `${seg}[${i}]`], a, b: xb[i], side: 'after' };
      const r = firstDiff(xa[i], xb[i], [...segs, `${seg}[${i}]`], A, B, a, b);
      if (r) return r;
    } else if ((va && typeof va === 'object') || (vb && typeof vb === 'object')) {
      const r = firstDiff(va, vb, [...segs, seg], A, B, a, b);
      if (r) return r;
    } else if (va !== vb && !(emptyish(va) && emptyish(vb))) {
      return { segs: [...segs, seg], a, b };
    }
  }
  return null;
}

/**
 * Where the after unit departs from the before unit.
 * @param {CanonicalUnit} before
 * @param {CanonicalUnit} after
 * @returns {VerdictLocation}
 */
export function locateDifference(before, after) {
  const d = firstDiff(before.node, after.node, [], before.renames, after.renames);
  const side = d?.side ?? 'after';
  const unit = side === 'before' ? before : after;
  const node = d ? (side === 'before' ? d.a : d.b) ?? unit.node : unit.node;
  const segs = d?.segs.length ? d.segs : [unwrap(unit.node).type];
  return {
    astPath: [unit.fn, ...segs].join('/'),
    file: unit.file,
    line: node.loc.start.line,
    column: node.loc.start.column + 1,
    ...(side === 'before' ? { side } : {}),
  };
}

/**
 * The L0 canonical compare of one unit before and after a step. `same-behaviour` when the canonical forms are equal
 * (a proof); `changed` with the exact location otherwise; `cant-tell` when a side has no such unit or the pinned
 * tools are missing. A mismatch is decisive only for closed-set transforms (escalation.isDecisive): on a hand edit
 * (`transforms` null) the result says so in `reason` and the next layer decides.
 * @param {UnitSpec} before
 * @param {UnitSpec} after
 * @param {{transforms?: TransformId[]|null}} [opts]
 * @returns {LayerResult & {hash?: {before: string, after: string}}}
 */
export function canonicalCompare(before, after, { transforms = null } = {}) {
  const t0 = performance.now();
  const ms = () => Math.round((performance.now() - t0) * 1000) / 1000;
  let b;
  let a;
  try {
    b = canonicalUnit(before);
    a = canonicalUnit(after);
  } catch (err) {
    return { layer: 'L0-canonical', outcome: 'cant-tell', reason: `the canonical form could not be built: ${/** @type {Error} */ (err).message}`, ms: ms() };
  }
  if (!b || !a) return { layer: 'L0-canonical', outcome: 'cant-tell', reason: `${!b ? `${before.fn} is not in ${before.file} before` : `${after.fn} is not in ${after.file} after`} the step`, ms: ms() };
  const hash = { before: b.hash, after: a.hash };
  if (a.text === b.text) return { layer: 'L0-canonical', outcome: 'same-behaviour', hash, ms: ms() };
  return {
    layer: 'L0-canonical', outcome: 'changed', location: locateDifference(b, a), hash,
    ...(transforms === null ? { reason: 'edited outside the closed transform set, so this text mismatch is not decisive' } : {}),
    ms: ms(),
  };
}
