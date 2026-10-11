// Line Import v2, step 2: the LOGIC MAP block (docs/line/import-v2/CONTRACT.md). Every decision, effect, data call,
// navigation, handler and export in a route family's files, each with a fingerprint that survives a file move and a
// rename, so an import can be checked unit by unit: compareLogicMaps says what was kept, moved, changed or lost.
//
// Static and deterministic: one typescript-estree parse per file, then Construct's existing detectors where they
// cover a kind (the rest is a small walk over the same tree):
//   render-if                  packages/ast jsxComplexity.collectInlineJsxLogic (conditionals that produce JSX)
//   state, effect, derived     packages/ast staleness.collectControllerStateCalls (+ stateShape.collectBagOfFlagsStates in the detail)
//   url-read                   packages/ast staleness.collectParamsReads
//   handler                    packages/ast jsxTree.parseJsxTree (on* props of every element)
//   storage                    packages/ast domainPurity.collectImpureDomainReferences (free localStorage/sessionStorage)
//   data, io, export           core mechanical-plan.readSignals (RTK-query hooks and io calls; component/hook/function names)
//   branch (xstate)            engine workflowExtractor.extractMachines (one unit per machine transition)
//   branch, navigation, toast, analytics   the walk below (no detector covers them)
//
// The map is stored at <folder>/line/logic-map.json through the transactional writer's writeLineState.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseToAst, walkAst, collectInlineJsxLogic, collectControllerStateCalls, collectParamsReads, collectBagOfFlagsStates, collectImpureDomainReferences, parseJsxTree } from '@construct/ast';
import { readSignals } from '@line/construct-core/mechanical-plan';
import { extractMachines } from '../workflowExtractor.mjs';
import { writeLineState } from '../transactionalWriter.mjs';
import { LOGIC_UNIT_KINDS, LOGIC_MAP_FILE } from './importV2/contract.mjs';

/** @typedef {import('./importV2/contract.mjs').LogicUnit} LogicUnit */
/** @typedef {import('./importV2/contract.mjs').LogicUnitKind} LogicUnitKind */
/** @typedef {import('./importV2/contract.mjs').LogicMap} LogicMap */
/** @typedef {import('./importV2/contract.mjs').MapDiff} MapDiff */
/** @typedef {Record<string, string>} RenameTable Old identifier -> new identifier. */

const STATE_KIND = /** @type {Record<string, LogicUnitKind>} */ ({ useState: 'state', useReducer: 'state', useEffect: 'effect', useLayoutEffect: 'effect', useMemo: 'derived', useCallback: 'derived' });
const RTK_QUERY_HOOK = /^use[A-Z]\w*(?:Query|Mutation)$/;
const STORAGE = new Set(['localStorage', 'sessionStorage']);
const NAVIGATION = /^(router|navigation|navigate)\.(push|replace|back|forward|refresh|prefetch)$|^(redirect|permanentRedirect|notFound|navigate)$|^(window\.)?location\.(assign|replace|reload)$|^(\w*(params|search|query)\w*)\.(set|delete|append)$/i;
const ANALYTICS = /(^|\.)(analyticsService|analytics|matomo|gtag|posthog|mixpanel|segment)\b|(^|\.)track[A-Z]?\w*$/;
const TOAST = /(^|\.)\w*[tT]oast\b/;
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const DROP_KEYS = new Set(['range', 'loc', 'parent', 'raw', 'comments', 'tokens', 'start', 'end', 'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'decorators']);

/**
 * Normalized AST text of a node: its structure with identifiers mapped through `renames`, literal values (so quote
 * style never matters), and no positions, comments, whitespace or type annotations.
 * @param {any} node An ESTree node (or a value inside one).
 * @param {RenameTable} renames
 * @returns {string}
 */
export function normalizeNode(node, renames = {}) {
  if (node === null || node === undefined) return '_';
  if (Array.isArray(node)) return `[${node.map((n) => normalizeNode(n, renames)).join(',')}]`;
  if (typeof node !== 'object') return JSON.stringify(node);
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier' || node.type === 'PrivateIdentifier') return `${node.type === 'JSXIdentifier' ? 'J' : 'I'}:${renames[node.name] ?? node.name}`;
  if (node.type === 'Literal') return `L:${JSON.stringify(node.regex ? `/${node.regex.pattern}/${node.regex.flags}` : node.bigint ?? node.value)}`;
  if (node.type === 'TemplateElement') return `T:${JSON.stringify(node.value?.cooked ?? '')}`;
  if (node.type === 'JSXText') { const t = node.value.replace(/\s+/g, ' ').trim(); return t ? `X:${JSON.stringify(t)}` : ''; }
  if (node.type === 'TSAsExpression' || node.type === 'TSNonNullExpression' || node.type === 'TSSatisfiesExpression') return normalizeNode(node.expression, renames);
  const parts = [];
  for (const key of Object.keys(node).sort()) {
    if (key === 'type' || DROP_KEYS.has(key)) continue;
    const v = node[key];
    if (v === undefined || v === false || (Array.isArray(v) && v.length === 0)) continue;
    const s = normalizeNode(v, renames);
    if (s) parts.push(`${key}=${s}`);
  }
  return `(${node.type}${parts.length ? ' ' + parts.join(' ') : ''})`;
}

const hash = (/** @type {string} */ s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * The fingerprint of a unit: a hash of its kind, its enclosing function (through the rename table) and its normalized
 * AST text. The file path is never part of it.
 * @param {LogicUnitKind} kind
 * @param {string} fn
 * @param {string} anchor normalizeNode text of the unit's anchor node.
 * @param {RenameTable} [renames]
 * @returns {string} 16 hex characters.
 */
export function unitFingerprint(kind, fn, anchor, renames = {}) {
  return hash(`${kind}\u0000${renameFn(fn, renames)}\u0000${anchor}`);
}

const renameFn = (/** @type {string} */ fn, /** @type {RenameTable} */ renames) => fn.replace(/[A-Za-z_$][\w$]*/g, (w) => renames[w] ?? w);

/** Name a function node the way a person would: its own name, its variable, its property, or `on:<attr>` for an inline handler. */
function functionName(node, parent, grand) {
  if (node.id?.name) return node.id.name;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if ((parent?.type === 'Property' || parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') && parent.key?.type === 'Identifier') return parent.key.name;
  if (parent?.type === 'JSXExpressionContainer' && grand?.type === 'JSXAttribute') return `on:${grand.name.name ?? '?'}`;
  // useCallback(() => ..., deps) / useMemo(...) assigned to a const: the const names it
  if (parent?.type === 'CallExpression' && grand?.type === 'VariableDeclarator' && grand.id.type === 'Identifier' && /^use(Callback|Memo)$/.test(parent.callee?.name ?? '')) return grand.id.name;
  return null;
}

/** Text of a callee: `a.b.c` for member chains, `a` for identifiers, the source slice otherwise. */
function calleeText(callee, source) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') return `${calleeText(callee.object, source)}.${callee.property.name}`;
  if (callee.type === 'ChainExpression') return calleeText(callee.expression, source);
  return source.slice(callee.range[0], callee.range[1]);
}
const rootName = (callee) => { let c = callee; while (c && (c.type === 'MemberExpression' || c.type === 'ChainExpression')) c = c.type === 'ChainExpression' ? c.expression : c.object; return c?.type === 'Identifier' ? c.name : null; };
const oneLine = (/** @type {string} */ s, n = 140) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Every logic unit in one file, in source order (before fingerprint de-duplication).
 * @param {string} source
 * @param {string} rel App-root-relative path.
 * @param {RenameTable} renames
 * @returns {{kind: LogicUnitKind, fn: string, line: number, detail: string, anchor: string, start: number}[]}
 */
export function fileUnits(source, rel, renames = {}) {
  const ast = parseToAst(source);
  const signals = readSignals(source, rel);
  const text = (n) => source.slice(n.range[0], n.range[1]);

  // One walk: parent links, enclosing function names, and nodes by start offset (the detectors report offsets).
  /** @type {Map<any, {parent: any, fn: string}>} */
  const info = new Map();
  /** @type {Map<number, any[]>} */
  const byStart = new Map();
  const fnStack = ['<module>'];
  walkAst(ast, {
    enter(node, parent) {
      info.set(node, { parent, fn: fnStack[fnStack.length - 1] });
      if (node.range) { const list = byStart.get(node.range[0]) ?? []; list.push(node); byStart.set(node.range[0], list); }
      if (FN_TYPES.has(node.type)) fnStack.push(functionName(node, parent, info.get(parent)?.parent) ?? fnStack[fnStack.length - 1]);
    },
    leave(node) { if (FN_TYPES.has(node.type)) fnStack.pop(); },
  });
  const at = (offset, type) => (byStart.get(offset) ?? []).find((n) => n.type === type);
  const parentOf = (n) => info.get(n)?.parent;

  /** @type {Map<any, {kind: LogicUnitKind, detail: string, anchorNode?: any, anchorText?: string}>} */
  const found = new Map();
  const add = (node, kind, detail, anchorNode = node) => { if (node && !found.has(node)) found.set(node, { kind, detail, anchorNode }); };

  // render-if: conditionals that produce JSX (collectInlineJsxLogic); the anchor is the condition.
  const renderIfs = new Set();
  if (signals.jsx) {
    for (const hit of collectInlineJsxLogic(ast)) {
      if (hit.kind !== 'conditional') continue;
      const n = hit.node;
      const cond = n.type === 'ConditionalExpression' ? n.test : n.left;
      renderIfs.add(n);
      add(n, 'render-if', n.type === 'ConditionalExpression' ? `${text(cond)} ? … : …` : `${text(cond)} ${n.operator} …`, cond);
    }
  }

  // state / effect / derived: the hook calls collectControllerStateCalls finds (useRef is not logic and is skipped).
  const bags = signals.stateHooks.size ? collectBagOfFlagsStates(ast, source) : [];
  for (const hit of signals.stateHooks.size ? collectControllerStateCalls(ast) : []) {
    const kind = STATE_KIND[hit.name];
    const call = at(hit.index, 'CallExpression');
    if (!kind || !call) continue;
    const decl = parentOf(call)?.type === 'VariableDeclarator' ? parentOf(call) : null;
    if (kind === 'state') {
      const bag = bags.find((b) => b.index >= call.range[0] && b.index < call.range[1]);
      add(call, kind, `${decl ? text(decl.id) : ''} = ${hit.name}(${oneLine(call.arguments[0] ? text(call.arguments[0]) : '', 60)})${bag ? ` (flags ${bag.flags.join(', ')} can clash)` : ''}`, decl ?? call);
    } else {
      const deps = call.arguments[1];
      add(call, kind, `${decl ? `${text(decl.id)} = ` : ''}${hit.name}, deps ${deps ? text(deps) : 'none'}`, call);
    }
  }

  // url-read: params / searchParams reads (collectParamsReads); `searchParams.get(x)` is anchored on the call.
  for (const hit of collectParamsReads(ast)) {
    const n = (byStart.get(hit.index) ?? []).find((x) => ['MemberExpression', 'VariableDeclarator', 'Property'].includes(x.type));
    if (!n) continue;
    const p = parentOf(n);
    const node = n.type === 'MemberExpression' && p?.type === 'CallExpression' && p.callee === n ? p : n;
    if (node !== n && /^(set|delete|append|sort|toString)$/.test(n.property?.name ?? '')) continue; // a write to the params is navigation, below
    add(node, 'url-read', text(node));
  }

  // storage: free references to localStorage / sessionStorage (collectImpureDomainReferences), anchored on the call that uses them.
  for (const hit of signals.io.has('localStorage') || signals.io.has('sessionStorage') ? collectImpureDomainReferences(ast) : []) {
    if (!STORAGE.has(hit.name)) continue;
    let n = at(hit.index, 'Identifier');
    while (parentOf(n)?.type === 'MemberExpression' && parentOf(n).object === n) n = parentOf(n);
    const p = parentOf(n);
    const node = p?.type === 'CallExpression' && p.callee === n ? p : n;
    add(node, 'storage', text(node));
  }

  // handler: on* props of every element (parseJsxTree), matched back to this tree by offset.
  if (signals.jsx) {
    for (const rec of parseJsxTree(source).byId.values()) {
      for (const prop of rec.props) {
        if (!prop.name || !/^on[A-Z]/.test(prop.name) || (prop.kind !== 'expression' && prop.kind !== 'identifier')) continue;
        const attrNode = rec.openingElementNode.attributes[prop.index];
        const attr = at(attrNode.range[0], 'JSXAttribute');
        if (attr) add(attr, 'handler', `${prop.name}=${oneLine(String(prop.value), 80)}`);
      }
    }
  }

  // The walk for what no detector covers: branches, data hooks, navigation, analytics, toasts, io, exports.
  const ioNames = new Set([...signals.io].filter((n) => !STORAGE.has(n) && !RTK_QUERY_HOOK.test(n)));
  const shapeOf = (name) => (signals.definedHooks.includes(name) ? 'hook' : signals.components.includes(name) ? 'component' : 'function');
  walkAst(ast, {
    enter(node) {
      if (found.has(node)) return;
      if (node.type === 'IfStatement') add(node, 'branch', `if (${oneLine(text(node.test), 120)})`, node.test);
      else if (node.type === 'ConditionalExpression' && !renderIfs.has(node)) add(node, 'branch', `${oneLine(text(node.test), 120)} ? …`, node.test);
      else if (node.type === 'LogicalExpression' && parentOf(node)?.type === 'JSXExpressionContainer') {
        // `{flag && panel}` (JSX held in a variable) decides what renders; `prop={x ?? 'none'}` is a value fallback
        const inAttribute = parentOf(parentOf(node))?.type === 'JSXAttribute';
        add(node, inAttribute ? 'branch' : 'render-if', `${oneLine(text(node.left), 120)} ${node.operator} …`, node.left);
      }
      else if (node.type === 'SwitchCase') {
        const sw = parentOf(node);
        add(node, 'branch', `case ${node.test ? text(node.test) : 'default'}`, { type: 'Case', on: sw.discriminant, test: node.test });
      } else if (node.type === 'CallExpression') {
        const callee = calleeText(node.callee, source);
        const arg0 = node.arguments[0] ? oneLine(text(node.arguments[0]), 80) : '';
        const root = rootName(node.callee);
        if (node.callee.type === 'Identifier' && RTK_QUERY_HOOK.test(callee) && signals.io.has(callee)) add(node, 'data', `${callee}(${arg0})`);
        else if (NAVIGATION.test(callee)) add(node, 'navigation', `${callee}(${arg0})`);
        else if (ANALYTICS.test(callee)) add(node, 'analytics', `${callee}(${oneLine(arg0, 60)})`);
        else if (TOAST.test(callee)) add(node, 'toast', `${callee}(${oneLine(arg0, 60)})`);
        else if (root && ioNames.has(root)) add(node, 'io', `${callee}(${oneLine(arg0, 60)})`);
      } else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
        const d = node.declaration;
        if (d?.type === 'FunctionDeclaration') add(node, 'export', `${shapeOf(d.id?.name ?? 'default')} ${d.id?.name ?? 'default'}`, { type: 'ExportFn', id: d.id, params: d.params });
        else if (d?.type === 'VariableDeclaration') {
          add(node, 'export', d.declarations.map((x) => `${FN_TYPES.has(x.init?.type) ? shapeOf(text(x.id)) : 'const'} ${text(x.id)}`).join(', '), { type: 'ExportVar', ids: d.declarations.map((x) => x.id), fns: d.declarations.map((x) => (FN_TYPES.has(x.init?.type) ? /** @type {any} */ (x.init).params : null)) });
        }
      }
    },
  });

  // xstate machines: one branch per transition (extractMachines); rare in route code, so only when readSignals saw one.
  const machineUnits = [];
  if (signals.machine.has('createMachine') || signals.machine.has('setup')) {
    for (const m of extractMachines(source).machines ?? []) {
      for (const t of m.transitions ?? []) {
        const detail = `machine ${m.id}: ${t.from ?? t.source ?? '?'} --${t.event ?? '?'}--> ${t.to ?? t.target ?? '?'}${t.guard ? ` [${t.guard}]` : ''}`;
        machineUnits.push({ kind: /** @type {LogicUnitKind} */ ('branch'), fn: m.exportName ?? m.id ?? '<module>', line: t.line ?? m.line ?? 1, detail: oneLine(detail), anchor: `machine:${normalizeNode(detail, renames)}`, start: Number.MAX_SAFE_INTEGER });
      }
    }
  }

  const units = [...found].map(([node, u]) => ({
    kind: u.kind,
    fn: info.get(node)?.fn ?? '<module>',
    line: node.loc.start.line,
    detail: oneLine(u.detail),
    anchor: normalizeNode(u.anchorNode, renames),
    start: node.range[0],
  }));
  return [...units.sort((a, b) => a.start - b.start), ...machineUnits];
}

/**
 * Build the logic map of `files` (app-root-relative) under `appRoot`. Fingerprints that collide within the map (the
 * same logic twice in one function) are made unique by their order: the second gets `#2` hashed in, and so on.
 * @param {string} appRoot
 * @param {string[]} files
 * @param {{renames?: RenameTable, read?: (abs: string) => string}} [options] `renames` maps identifiers before hashing; `read` replaces fs (tests).
 * @returns {LogicMap}
 */
export function buildLogicMap(appRoot, files, { renames = {}, read = (abs) => fs.readFileSync(abs, 'utf8') } = {}) {
  /** @type {LogicUnit[]} */
  const units = [];
  const seen = new Map();
  for (const file of files) {
    const rel = file.split(path.sep).join('/');
    const counters = new Map();
    for (const u of fileUnits(read(path.join(appRoot, rel)), rel, renames)) {
      const base = unitFingerprint(u.kind, u.fn, u.anchor, renames);
      const k = (seen.get(base) ?? 0) + 1;
      seen.set(base, k);
      const key = `${rel}#${u.fn}:${u.kind}`;
      counters.set(key, (counters.get(key) ?? 0) + 1);
      units.push({ id: `${key}:${counters.get(key)}`, fingerprint: k === 1 ? base : hash(`${base}#${k}`), kind: u.kind, file: rel, fn: u.fn, line: u.line, detail: u.detail, anchor: u.anchor });
    }
  }
  /** @type {Partial<Record<LogicUnitKind, number>>} */
  const counts = {};
  for (const k of LOGIC_UNIT_KINDS) { const n = units.filter((u) => u.kind === k).length; if (n) counts[k] = n; }
  return { root: appRoot, files: files.map((f) => f.split(path.sep).join('/')), units, counts };
}

const KIND_WORDS = /** @type {Record<LogicUnitKind, string>} */ ({ branch: 'branch', 'render-if': 'conditional render', state: 'state', effect: 'effect', derived: 'derived value', data: 'data call', navigation: 'navigation', 'url-read': 'URL read', handler: 'event handler', toast: 'toast', analytics: 'analytics call', storage: 'storage call', io: 'network call', export: 'export' });
const quote = (/** @type {string} */ s) => `"${s.replace(/"/g, "'")}"`;
const tokens = (/** @type {string} */ s) => new Set(s.match(/[A-Za-z_$][\w$]*|\d+|[^\s\w]+/g) ?? []);
function similarity(a, b) {
  const x = tokens(a); const y = tokens(b);
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both || 1);
}

/**
 * Re-hash a map's fingerprints through a rename table (old -> new), when its units still carry their anchors.
 * @param {LogicMap} map
 * @param {RenameTable} renames
 * @returns {LogicUnit[]}
 */
function rehash(map, renames) {
  if (!Object.keys(renames).length) return map.units;
  const seen = new Map();
  return map.units.map((u) => {
    if (u.anchor === undefined) return u;
    const anchor = u.anchor.replace(/([IJ]):([A-Za-z_$][\w$]*)/g, (m, t, name) => `${t}:${renames[name] ?? name}`);
    const base = unitFingerprint(u.kind, u.fn, anchor, renames);
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return { ...u, fingerprint: k === 1 ? base : hash(`${base}#${k}`) };
  });
}

/**
 * Compare the map before an import step with the map after it. A unit with the same fingerprint is kept (same file)
 * or moved (another file). Of the rest, a before unit and an after unit of the same kind in the same function whose
 * text is alike are one unit that changed; a before unit with no partner is missing (with one sentence), an after
 * unit with none is added. `renames` (old -> new) maps the before side's identifiers, so a renamed component keeps
 * its units.
 * @param {LogicMap} before
 * @param {LogicMap} after
 * @param {{renames?: RenameTable, threshold?: number}} [options] `threshold` is the least token similarity for "changed" (default 0.3).
 * @returns {MapDiff}
 */
export function compareLogicMaps(before, after, { renames = {}, threshold = 0.3 } = {}) {
  const b = rehash(before, renames);
  const byFp = new Map(after.units.map((u) => [u.fingerprint, u]));
  /** @type {MapDiff} */
  const diff = { kept: [], moved: [], missing: [], changed: [], added: [] };
  const used = new Set();
  const left = [];
  b.forEach((u, i) => {
    const a = byFp.get(u.fingerprint);
    if (a && !used.has(a)) {
      used.add(a);
      if (a.file === u.file) diff.kept.push(a);
      else diff.moved.push({ from: before.units[i], to: a });
    } else left.push(i);
  });
  const rest = after.units.filter((u) => !used.has(u));
  for (const i of left) {
    const u = before.units[i];
    const fn = renameFn(u.fn, renames);
    let best = null; let bestScore = threshold;
    for (const a of rest) {
      if (used.has(a) || a.kind !== u.kind || a.fn !== fn) continue;
      const score = similarity(u.anchor ?? u.detail, a.anchor ?? a.detail);
      if (score >= bestScore) { best = a; bestScore = score; }
    }
    if (best) {
      used.add(best);
      diff.changed.push({ before: u, after: best, sentence: `The ${KIND_WORDS[u.kind]} in ${fn} changed from ${quote(u.detail)} to ${quote(best.detail)}.` });
    } else {
      diff.missing.push({ ...u, sentence: `The ${KIND_WORDS[u.kind]} ${quote(u.detail)} in ${u.fn} (${u.file}:${u.line}) is missing after the import.` });
    }
  }
  diff.added = rest.filter((a) => !used.has(a));
  return diff;
}

/**
 * Store a logic map at `<folder>/line/logic-map.json` through the transactional writer (writeLineState).
 * @param {string} folder The Line folder (the root writeLineState writes under).
 * @param {LogicMap} map
 * @param {{stateDir?: string}} [options]
 * @returns {string} The folder-relative path written.
 */
export function writeLogicMap(folder, map, { stateDir = 'line' } = {}) {
  const rel = stateDir === 'line' ? LOGIC_MAP_FILE : `${stateDir}/logic-map.json`;
  return writeLineState(folder, rel, `${JSON.stringify(map, null, 2)}\n`, { stateDir });
}

/**
 * Read the logic map stored at `<folder>/line/logic-map.json`, or null when there is none.
 * @param {string} folder
 * @param {{stateDir?: string}} [options]
 * @returns {LogicMap|null}
 */
export function readLogicMap(folder, { stateDir = 'line' } = {}) {
  try { return JSON.parse(fs.readFileSync(path.join(folder, stateDir, 'logic-map.json'), 'utf8')); } catch (e) { if (/** @type {any} */ (e).code === 'ENOENT') return null; throw e; }
}
