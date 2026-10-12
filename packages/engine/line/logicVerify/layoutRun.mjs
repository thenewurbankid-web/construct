// Line logic verification, spec E (step 5): run the pure layout-reading functions of a unit under the layout fakes, before
// and after, and report the first input where they differ. This is the helper step 4's isolated runner calls for
// layout; it is not the sandbox. It loads nothing from the app: each reader's own source is transpiled (types stripped)
// and evaluated in a fresh vm context whose only globals are the layout DOM's window and document.
//
//   layoutReaders(source, file, fn)   the closures inside unit `fn` that read layout and nothing else from outside
//                                     (`() => window.innerWidth < 768`, `(entry) => entry.intersectionRatio > 0.5`),
//                                     each with its astPath, its layout reads and its parameter's fake type
//   runLayoutCases(code, cases, opts) one record per case: the case's reads, the output's shape (G2 shapeOf) and, for a
//                                     primitive, its value; or the thrown error's name (NotFakedError names the member)
//   verifyLayoutPair({beforeRoot, afterRoot, unit})
//                                     the `isolated` LayerResult: `changed` at the exact node with the first diverging
//                                     input (cases ordered by read, then value, from the mined literals of both sides)
//
// Hooks and handlers that close over component state (`() => setCompact(window.innerWidth < 768)`) are not pure readers;
// they need step 4's headless hook runner and are counted in the result's reason, never assumed fine.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { ts, estreeParse } from '@construct/ast/lazy';
import { analyzeClosure } from '../characterize/analyze.mjs';
import { LAYOUT_FAKE_TYPES, mergePools } from './layoutFakes.mjs';
import { createLayoutFakeGenerator } from './layoutFakeGen.mjs';
import { createFakeClock } from './layoutClock.mjs';
import { parseMediaQuery } from './layoutMedia.mjs';

const require = createRequire(import.meta.url);
const { shapeOf } = require('../graph/runtime/recorder.cjs');

/** Globals a pure layout reader may use besides the layout ones. */
const BUILTINS = new Set(['Math', 'Number', 'Boolean', 'String', 'JSON', 'Array', 'Object', 'Infinity', 'NaN', 'undefined', 'isFinite', 'isNaN', 'parseInt', 'parseFloat']);
const WINDOW_NAMES = new Set(['window', 'globalThis', 'self']);
const members = (name) => Object.keys(/** @type {any} */ (LAYOUT_FAKE_TYPES.find((t) => t.name === name)).members);
const WINDOW_MEMBERS = new Set(members('Window'));
const DOCUMENT_MEMBERS = new Set(members('Document'));
/** The layout globals: `window`, `document`, `matchMedia` and the bare Window layout members (`innerWidth`). */
const LAYOUT_GLOBALS = new Set([...WINDOW_NAMES, 'document', 'matchMedia', ...WINDOW_MEMBERS]);
/** A parameter's fake type, chosen by the members the reader reads from it, most specific first. */
const PARAM_TYPES = [
  ['IntersectionObserverEntry', members('IntersectionObserverEntry')],
  ['ResizeObserverEntry', members('ResizeObserverEntry')],
  ['HTMLElement', [...members('HTMLElement'), ...members('Element'), 'getBoundingClientRect']],
  ['PointerEvent', [...members('MouseEvent'), ...members('PointerEvent')]],
  ['DOMRect', members('DOMRect')],
];
/** The type of a member read through another (entry.boundingClientRect.width reads DOMRect.width). */
const NESTED = { boundingClientRect: 'DOMRect', intersectionRect: 'DOMRect', rootBounds: 'DOMRect', contentRect: 'DOMRect', getBoundingClientRect: 'DOMRect' };
/** The reads a param type's own members map to (`HTMLElement.clientWidth` lives on Element). */
const readOf = (type, m) => {
  if (type === 'HTMLElement') return members('HTMLElement').includes(m) ? `HTMLElement.${m}` : `Element.${m}`;
  if (type === 'PointerEvent') return members('PointerEvent').includes(m) ? `PointerEvent.${m}` : `MouseEvent.${m}`;
  return `${type}.${m}`;
};
const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'type', 'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'decorators']);
const FN_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression']);
const LEAVES = new Set(['Literal', 'Identifier', 'TemplateElement', 'PrivateIdentifier', 'ThisExpression', 'Super']);
const PRIMITIVE_FIELDS = ['operator', 'kind', 'computed', 'optional', 'prefix', 'async', 'generator', 'method', 'shorthand', 'delegate'];

/** The child nodes of an ESTree node, with the segment that names each (`BinaryExpression.right`, `Block.body[0]`). */
function children(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((x, i) => { if (x && typeof x.type === 'string') out.push({ seg: `${node.type}.${key}[${i}]`, key, i, node: x }); });
    else if (v && typeof v.type === 'string') out.push({ seg: `${node.type}.${key}`, key, i: null, node: v });
  }
  return out;
}

/** The unit's function node: `function fn`, `const fn = () =>` / `function () {}`, exported or not. */
function findUnit(program, fn) {
  let found = null;
  const visit = (n) => {
    if (found || !n || typeof n.type !== 'string') return;
    if (n.type === 'FunctionDeclaration' && n.id?.name === fn) { found = n; return; }
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.id.name === fn && n.init && FN_TYPES.has(n.init.type)) { found = n.init; return; }
    for (const c of children(n)) visit(c.node);
  };
  visit(program);
  return found;
}

/** Names a function declares anywhere inside it (params, variables, functions, catch params, its own name). */
function declared(fnNode) {
  const names = new Set();
  const pattern = (p) => {
    if (!p) return;
    if (p.type === 'Identifier') names.add(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((x) => pattern(x.type === 'RestElement' ? x.argument : x.value));
    else if (p.type === 'ArrayPattern') p.elements.forEach(pattern);
    else if (p.type === 'AssignmentPattern') pattern(p.left);
    else if (p.type === 'RestElement') pattern(p.argument);
  };
  const visit = (n) => {
    if (n.type === 'VariableDeclarator') pattern(n.id);
    if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression') && n.id) names.add(n.id.name);
    if (FN_TYPES.has(n.type) || n.type === 'FunctionDeclaration') n.params.forEach(pattern);
    if (n.type === 'CatchClause') pattern(n.param);
    for (const c of children(n)) visit(c.node);
  };
  visit(fnNode);
  return names;
}

/** Identifiers used as values inside a node (not property names, keys or labels). */
function usedNames(root) {
  const out = new Set();
  const visit = (n, parent, key) => {
    if (n.type === 'Identifier') {
      const nonUsage = (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed)
        || (parent?.type === 'Property' && key === 'key' && !parent.computed && !parent.shorthand)
        || (/Label/.test(parent?.type ?? '') || parent?.type === 'BreakStatement' || parent?.type === 'ContinueStatement');
      if (!nonUsage) out.add(n.name);
      return;
    }
    if (/^TS/.test(n.type)) return;
    for (const c of children(n)) visit(c.node, n, c.key);
  };
  visit(root, null, null);
  return out;
}

/**
 * One pure layout-reading closure.
 * @typedef {{path: string[], node: any, code: string, reads: string[], param: string|null, paramType: string|null, queries: string[]}} LayoutReader
 */

/** The layout reads of a closure, its matchMedia queries and its parameter's fake type; null when it is not a reader. */
function readsOf(fnNode) {
  const params = fnNode.params;
  if (params.length > 1 || (params[0] && params[0].type !== 'Identifier')) return null;
  const param = params[0]?.name ?? null;
  const reads = new Set();
  const queries = [];
  const paramMembers = new Set();
  const nested = [];
  const visit = (n, parent) => {
    if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') {
      const obj = n.object;
      const m = n.property.name;
      if (obj.type === 'Identifier' && WINDOW_NAMES.has(obj.name) && WINDOW_MEMBERS.has(m)) reads.add(`Window.${m}`);
      if (obj.type === 'Identifier' && obj.name === 'document' && DOCUMENT_MEMBERS.has(m)) reads.add(`Document.${m}`);
      if (obj.type === 'MemberExpression' && !obj.computed && obj.object.type === 'Identifier' && obj.object.name === 'document' && obj.property.name === 'documentElement') {
        const map = { clientWidth: 'Window.innerWidth', clientHeight: 'Window.innerHeight', scrollTop: 'Window.scrollY', scrollLeft: 'Window.scrollX' };
        if (map[m]) reads.add(map[m]);
      }
      if (param && obj.type === 'Identifier' && obj.name === param) paramMembers.add(m);
      // param.boundingClientRect.width, param.getBoundingClientRect().top
      const inner = obj.type === 'CallExpression' ? obj.callee : obj;
      if (param && inner.type === 'MemberExpression' && !inner.computed && inner.object.type === 'Identifier' && inner.object.name === param && NESTED[inner.property.name]) nested.push(`${NESTED[inner.property.name]}.${m}`);
    }
    if (n.type === 'Identifier' && WINDOW_MEMBERS.has(n.name) && !(parent?.type === 'MemberExpression' && parent.property === n && !parent.computed)) reads.add(`Window.${n.name}`);
    if (n.type === 'CallExpression') {
      const c = n.callee;
      const isMM = (c.type === 'Identifier' && c.name === 'matchMedia') || (c.type === 'MemberExpression' && !c.computed && c.property.name === 'matchMedia' && c.object.type === 'Identifier' && WINDOW_NAMES.has(c.object.name));
      if (isMM) {
        const a = n.arguments[0];
        if (a?.type === 'Literal' && typeof a.value === 'string') {
          queries.push(a.value);
          for (const q of parseMediaQuery(a.value)) for (const f of q.features) {
            if (f.name === 'width' || f.name === 'orientation') reads.add('Window.innerWidth');
            if (f.name === 'height' || f.name === 'orientation') reads.add('Window.innerHeight');
          }
        } else reads.add('Window.innerWidth');
      }
    }
    if (/^TS/.test(n.type)) return;
    for (const ch of children(n)) visit(ch.node, n);
  };
  visit(fnNode.body, fnNode);
  let paramType = null;
  if (param && paramMembers.size) {
    const hit = PARAM_TYPES.find(([, ms]) => [...paramMembers].every((m) => ms.includes(m)));
    if (!hit) return null;
    paramType = hit[0];
    for (const m of paramMembers) if (!NESTED[m] && m !== 'target') reads.add(readOf(paramType, m));
    for (const r of nested) reads.add(r);
  }
  return reads.size ? { reads: [...reads].sort(), queries, param, paramType } : null;
}

/**
 * The pure layout-reading closures inside unit `fn` of a source file, in source order.
 * @param {string} source
 * @param {string} file For JSX detection and messages.
 * @param {string} fn
 * @returns {{readers: LayoutReader[], impure: number, unit: any}}  `impure`: closures that read layout but close over
 *   something else (they need step 4's runner).
 */
export function layoutReaders(source, file, fn) {
  const program = estreeParse(source, { loc: true, range: true, jsx: /\.[jt]sx$/.test(file), comment: false });
  const unit = findUnit(program, fn);
  if (!unit) throw new TypeError(`${file} has no function ${fn}.`);
  const readers = [];
  let impure = 0;
  const visit = (n, segs) => {
    if (FN_TYPES.has(n.type) && n !== unit) {
      const r = readsOf(n);
      if (r) {
        const local = declared(n);
        const free = [...usedNames(n.body)].filter((x) => !local.has(x));
        if (free.every((x) => LAYOUT_GLOBALS.has(x) || BUILTINS.has(x))) readers.push({ path: segs, node: n, code: source.slice(n.range[0], n.range[1]), ...r });
        else impure++;
      }
    }
    for (const c of children(n)) visit(c.node, [...segs, c.seg]);
  };
  visit(unit, [fn]);
  return { readers, impure, unit };
}

/** Strip types from one closure's source; the result evaluates to the function. */
function compile(code) {
  return ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React, removeComments: true } }).outputText;
}

/**
 * One run of a reader under one case.
 * @typedef {{reads: Record<string, unknown>, output: string, value?: boolean|number|string|null, thrown: string|null, notFaked?: string}} LayoutRecord
 */

/**
 * Run a pure layout-reading function under each case. Each case gets a fresh layout DOM and fake clock (FAKE_ENV time)
 * and a fresh vm context whose globals are that DOM's window, document, matchMedia and bare Window layout members. A
 * parameter gets a fake of `paramType` made from the case (an element is created in the DOM). Outputs are recorded as
 * shapes; a primitive output also keeps its value (a layout answer such as `true` or `768`, never app data).
 * @param {string} code The function's source (TypeScript allowed).
 * @param {import('./layoutFakes.mjs').LayoutCase[]} cases
 * @param {{paramType?: string|null, gen?: ReturnType<typeof createLayoutFakeGenerator>}} [opts]
 * @returns {LayoutRecord[]}
 */
export function runLayoutCases(code, cases, { paramType = null, gen = createLayoutFakeGenerator() } = {}) {
  const js = compile(code);
  return cases.map((c) => {
    const clock = createFakeClock();
    const dom = gen.dom(clock, c);
    const ctx = { window: dom.window, self: dom.window, document: dom.document, matchMedia: dom.window.matchMedia };
    for (const m of WINDOW_MEMBERS) Object.defineProperty(ctx, m, { get: () => dom.window[m], enumerable: true });
    const fn = vm.runInNewContext(js, ctx, { timeout: 1000 });
    let arg;
    if (paramType === 'HTMLElement') arg = dom.element(c);
    else if (paramType) arg = gen.make(paramType, c, { state: dom.state, time: clock.elapsed() });
    try {
      const out = paramType ? fn(arg) : fn();
      const rec = { reads: c.reads, output: shapeOf(out), thrown: null };
      if (out === null || ['boolean', 'number', 'string'].includes(typeof out)) rec.value = out;
      return rec;
    } catch (e) {
      const err = /** @type {any} */ (e);
      return { reads: c.reads, output: 'undefined', thrown: err?.name ?? 'Error', ...(err?.name === 'NotFakedError' ? { notFaked: err.member } : {}) };
    }
  });
}

const sameRecord = (a, b) => a.output === b.output && a.value === b.value && a.thrown === b.thrown;

/**
 * Where two readers differ: the path down to the first differing node. A differing leaf (a literal, a name) is named by
 * its parent's segment (`BinaryExpression.right`); a differing operator by `<Type>.operator`.
 * @param {any} a The before node.
 * @param {any} b The after node.
 * @param {string[]} [segs] The path down to them.
 * @returns {{segs: string[], line: number}|null}
 */
export function firstDifference(a, b, segs = []) {
  if (a.type !== b.type) return { segs, line: b.loc.start.line };
  for (const f of PRIMITIVE_FIELDS) if (f in a && a[f] !== b[f]) return { segs: [...segs, `${a.type}.${f}`], line: b.loc.start.line };
  if (LEAVES.has(a.type)) return a.name === b.name && a.value === b.value && (a.type !== 'TemplateElement' || a.value.cooked === b.value.cooked) ? null : { segs, line: b.loc.start.line };
  const ca = children(a);
  const cb = children(b);
  for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
    const x = ca[i];
    const y = cb[i];
    if (!x || !y || x.seg !== y.seg) return { segs: [...segs, `${a.type}.${(x ?? y).key}`], line: (y ?? x).node.loc.start.line };
    if (x.node.type !== y.node.type || (LEAVES.has(x.node.type) && firstDifference(x.node, y.node))) return { segs: [...segs, x.seg], line: y.node.loc.start.line };
    const d = firstDifference(x.node, y.node, [...segs, x.seg]);
    if (d) return d;
  }
  return null;
}

/**
 * The `isolated` LayerResult for a unit's layout logic: run each pure layout reader before and after (paired by astPath)
 * under the cases from the mined literals of BOTH sides, and stop at the first case whose records differ.
 * @param {{beforeRoot: string, afterRoot: string, unit: import('./contract.mjs').UnitRef, beforeFile?: string, maxCases?: number}} args
 * @returns {import('./contract.mjs').LayerResult}
 */
export function verifyLayoutPair({ beforeRoot, afterRoot, unit, beforeFile = unit.file }) {
  const t0 = performance.now();
  const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
  const before = layoutReaders(read(beforeRoot, beforeFile), beforeFile, unit.fn);
  const after = layoutReaders(read(afterRoot, unit.file), unit.file, unit.fn);
  const byPath = new Map(before.readers.map((r) => [r.path.join('/'), r]));
  const pairs = after.readers.filter((r) => byPath.has(r.path.join('/'))).map((r) => [/** @type {LayoutReader} */ (byPath.get(r.path.join('/'))), r]);
  const unpaired = before.readers.length + after.readers.length - 2 * pairs.length;
  const pending = [unpaired && `${unpaired} layout reader(s) exist on one side only`, Math.max(before.impure, after.impure) && `${Math.max(before.impure, after.impure)} layout-reading closure(s) close over component state and need the hook runner`].filter(Boolean);
  if (!pairs.length) return { layer: 'isolated', outcome: 'skipped', reason: pending.length ? pending.join('; ') : 'the unit reads no layout' };
  const pools = mergePools(analyzeClosure(beforeRoot, { files: [beforeFile] }).pools, analyzeClosure(afterRoot, { files: [unit.file] }).pools);
  const gen = createLayoutFakeGenerator();
  const notFaked = new Set();
  for (const [b, a] of pairs) {
    const cases = gen.cases([...new Set([...b.reads, ...a.reads])], pools);
    const rb = runLayoutCases(b.code, cases, { paramType: b.paramType, gen });
    const ra = runLayoutCases(a.code, cases, { paramType: a.paramType, gen });
    for (let i = 0; i < cases.length; i++) {
      for (const r of [rb[i], ra[i]]) if (r.notFaked) notFaked.add(r.notFaked);
      if (sameRecord(rb[i], ra[i])) continue;
      const d = firstDifference(b.node, a.node, a.path) ?? { segs: a.path, line: a.node.loc.start.line };
      return { layer: 'isolated', outcome: 'changed', input: cases[i].reads, location: { astPath: d.segs.join('/'), file: unit.file, line: d.line }, ms: Math.round(performance.now() - t0) };
    }
  }
  if (notFaked.size) pending.unshift(`not faked: ${[...notFaked].sort().join(', ')}`);
  return { layer: 'isolated', outcome: pending.length ? 'cant-tell' : 'same-behaviour', ...(pending.length ? { reason: pending.join('; ') } : {}), ms: Math.round(performance.now() - t0) };
}
