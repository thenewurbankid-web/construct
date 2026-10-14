// QuickJS spike (#947), parts 3-5: execute a candidate page or store in QuickJS and read what it shows, with no jsdom.
//
//   bundleCandidate(ws, task, body) -> {ok, code} | {ok: false, error}
//       esbuild bundles the task's entries (task.entries: page, store) from the workspace `ws`, with the target file's
//       text replaced by `body` (in memory, nothing is written), as one IIFE; react, react/jsx-runtime and
//       @radix-ui/react-slot stay external and are served by the guest.
//   runScenarios({bundle, plan, scenarios, books, timeoutMs}) -> {ok, views: View[], planViews: View[]} | {ok: false, error, kind}
//       one QuickJS context (quickjs/quickjsRun.mjs evalGuest): the guest React below renders the page per scenario
//       (props, localStorage presets, clicks and select changes) into a host tree, and reads its View; `plan` (a plan
//       sketch's source, bench/isolation/plans/*.plan.js) gets the same scenarios and returns its View.
//   match(expected, view) -> string[]   the failed assertions (empty: the view satisfies `expected`)
//
// A View: {h1, lines, text, links: [{text, href}], buttons: [{text, disabled}], selects: [{label, options}], picks,
// lists?, stored?}. `lines` are the runs of adjacent text (normalized), in document order; an expected line
// matches a view line that contains it.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { evalGuest } from '../../../packages/engine/line/logicVerify/quickjs/quickjsRun.mjs';

/** The guest: a small hook-capable React (render to a host tree), the jsx runtime, Slot, localStorage, the view reader. */
export const GUEST_RUNTIME = String.raw`
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); },
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
globalThis.window = globalThis;
const Fragment = Symbol.for('react.fragment');
const el = (type, props, key) => ({ $$el: true, type, props: props || {}, key: key == null ? null : String(key) });
const jsx = (type, props, key) => el(type, props, key);
const createElement = (type, config, ...children) => { const props = { ...(config || {}) }; const key = props.key; delete props.key; if (children.length) props.children = children.length === 1 ? children[0] : children; return el(type, props, key); };
let cur = null; let dirty = false; let effects = []; const instances = new Map(); let seen = new Set();
const slot = (init) => { const i = cur.i++; if (!(i in cur.hooks)) cur.hooks[i] = init(); return cur.hooks[i]; };
const changed = (a, b) => !a || !b || a.length !== b.length || b.some((d, i) => !Object.is(d, a[i]));
const useState = (init) => { const s = slot(() => ({ v: typeof init === 'function' ? init() : init })); s.set ??= (v) => { const n = typeof v === 'function' ? v(s.v) : v; if (!Object.is(n, s.v)) { s.v = n; dirty = true; } }; return [s.v, s.set]; };
const useReducer = (r, a, f) => { const s = slot(() => ({ v: f ? f(a) : a })); s.d ??= (act) => { const n = r(s.v, act); if (!Object.is(n, s.v)) { s.v = n; dirty = true; } }; return [s.v, s.d]; };
const useEffect = (fn, deps) => { const s = slot(() => ({ fresh: true })); if (s.fresh || changed(s.deps, deps)) { s.fresh = false; s.deps = deps; effects.push(() => { if (typeof s.c === 'function') s.c(); s.c = fn(); }); } };
const useMemo = (fn, deps) => { const s = slot(() => ({ fresh: true })); if (s.fresh || changed(s.deps, deps)) { s.fresh = false; s.deps = deps; s.v = fn(); } return s.v; };
const createContext = (v) => { const c = { _v: v }; c.Provider = ({ value, children }) => { c._v = value; return children; }; c.Consumer = ({ children }) => children(c._v); return c; };
const React = {
  Fragment, createElement, useState, useReducer, useEffect, useLayoutEffect: useEffect, useMemo,
  useCallback: (fn, deps) => useMemo(() => fn, deps), useRef: (v) => slot(() => ({ current: v })),
  useContext: (c) => c && c._v, createContext, useId: () => 'id-' + cur.path.length + '-' + cur.i++,
  useTransition: () => [false, (cb) => cb()], useDeferredValue: (v) => v, useSyncExternalStore: (_s, get) => get(),
  memo: (c) => c, forwardRef: (c) => (p) => c(p, null), Children: { toArray: (c) => [].concat(c ?? []).flat(Infinity), map: (c, f) => [].concat(c ?? []).flat(Infinity).map(f) },
  isValidElement: (x) => !!(x && x.$$el), cloneElement: (e, p) => el(e.type, { ...e.props, ...p }, e.key),
};
const Slot = ({ children, ...rest }) => (children && children.$$el ? el(children.type, { ...rest, ...children.props }, children.key) : children);
const MODULES = { react: { ...React, default: React }, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment }, 'react/jsx-dev-runtime': { jsxDEV: jsx, Fragment }, '@radix-ui/react-slot': { Slot, Root: Slot } };
globalThis.require = (m) => { if (m in MODULES) return MODULES[m]; throw new Error('module not served in the sandbox: ' + m); };
function renderNode(node, p) {
  if (node == null || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap((c, i) => renderNode(c, p + '.' + (c && c.key != null ? 'k' + c.key : i)));
  if (!node.$$el) return [];
  const { type, props } = node;
  if (type === Fragment) return renderNode(props.children, p + '.f');
  if (typeof type === 'function') {
    const key = p + ':' + (type.name || 'c');
    seen.add(key);
    const inst = instances.get(key) ?? { hooks: [], path: key };
    instances.set(key, inst);
    const prev = cur; cur = inst; inst.i = 0;
    let out;
    try { out = type(props); } finally { cur = prev; }
    return renderNode(out, key);
  }
  const { children, ...rest } = props;
  return [{ tag: String(type), props: rest, children: renderNode(children, p + '.' + type) }];
}
let root = null;
function rerender() {
  let tree;
  for (let n = 0; ; n++) {
    if (n > 25) throw new Error('more than 25 renders');
    dirty = false; effects = []; seen = new Set();
    tree = renderNode(el(root.C, root.props), 'r');
    for (const e of effects) e();
    if (!dirty) break;
  }
  root.tree = tree;
  return tree;
}
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const textOf = (n) => (typeof n === 'string' ? n : n.children.map(textOf).join(''));
function walk(nodes, f) { for (const n of nodes) if (typeof n !== 'string') { f(n); walk(n.children, f); } }
function viewOf(tree) {
  const v = { h1: null, lines: [], text: norm(tree.map(textOf).join(' ')), links: [], buttons: [], selects: [] };
  const labels = [];
  // lines: each run of adjacent text children, in document order (an element's text before and after a child element
  // are two lines)
  (function lines(nodes) {
    let buf = '';
    const flush = () => { const t = norm(buf); if (t) v.lines.push(t); buf = ''; };
    for (const c of nodes) { if (typeof c === 'string') buf += c; else { flush(); lines(c.children); } }
    flush();
  })(tree);
  walk(tree, (n) => {
    if (n.tag === 'h1' && v.h1 === null) v.h1 = norm(textOf(n));
    if (n.tag === 'a' && n.props.href != null) v.links.push({ text: norm(textOf(n)), href: String(n.props.href) });
    if (n.tag === 'button') v.buttons.push({ text: norm(textOf(n)) || String(n.props['aria-label'] ?? ''), disabled: !!n.props.disabled, node: n });
    if (n.tag === 'label') labels.push(n);
  });
  walk(tree, (n) => {
    if (n.tag !== 'select') return;
    const lab = labels.find((l) => (l.props.htmlFor != null && l.props.htmlFor === n.props.id) || (function has(x) { return x.children.some((c) => c === n || (typeof c !== 'string' && has(c))); })(l));
    const label = lab ? norm(lab.children.filter((c) => typeof c === 'string').join('') || textOf(lab)) : String(n.props['aria-label'] ?? '');
    const options = [];
    walk(n.children, (o) => { if (o.tag === 'option') options.push({ text: norm(textOf(o)), value: o.props.value != null ? String(o.props.value) : norm(textOf(o)) }); });
    v.selects.push({ label, options, node: n });
  });
  return v;
}
const ev = (target) => ({ type: 'event', target, currentTarget: target, preventDefault() {}, stopPropagation() {}, nativeEvent: {} });
function act(a, v) {
  if (a.click) {
    const b = v.buttons.find((x) => x.text === a.click);
    if (!b) return 'no button "' + a.click + '"';
    if (typeof b.node.props.onClick === 'function') b.node.props.onClick(ev({ value: '' }));
  } else if (a.change) {
    const s = v.selects.find((x) => x.label === a.change || norm(x.label) === a.change);
    if (!s) return 'no select labelled "' + a.change + '"';
    const value = (s.options.find((o) => o.text === a.value) ?? { value: a.value }).value;
    const f = s.node.props.onChange;
    if (typeof f === 'function') f(ev({ value }));
  }
  rerender();
  return null;
}
const plainView = (v) => ({ h1: v.h1, lines: v.lines, text: v.text, links: v.links, buttons: v.buttons.map(({ text, disabled }) => ({ text, disabled })), selects: v.selects.map(({ label, options }) => ({ label, options: options.map((o) => o.text) })) });
function runPage(C, s, storeMod) {
  localStorage.clear();
  if (s.picks) localStorage.setItem('picks', JSON.stringify(s.picks));
  instances.clear();
  root = { C, props: s.props ?? {} };
  rerender();
  const errors = [];
  for (const a of s.actions ?? []) { const e = act(a, viewOf(root.tree)); if (e) { errors.push(e); break; } }
  const v = plainView(viewOf(root.tree));
  let picks = null;
  try { picks = storeMod && typeof storeMod.listPicks === 'function' ? storeMod.listPicks() : JSON.parse(localStorage.getItem('picks') ?? 'null'); } catch { picks = null; }
  return { ...v, picks, actionErrors: errors };
}
function runStore(m, s) {
  localStorage.clear();
  const lists = []; const stored = [];
  for (const [op, arg] of s.ops) {
    if (op === 'list') lists.push(m.listPicks());
    else if (op === 'add') m.addPick(arg);
    else if (op === 'remove') m.removePick(arg);
    else if (op === 'set') localStorage.setItem('picks', arg);
    else if (op === 'raw') { let x; try { x = JSON.parse(localStorage.getItem('picks')); } catch { x = '(not JSON)'; } stored.push(x); }
  }
  return { lists, stored };
}
`;

/** esbuild: the task's entries with the target's text replaced in memory. */
export async function bundleCandidate(ws, task, body) {
  const target = path.join(ws, task.target);
  const entry = Object.entries(task.entries).map(([k, p]) => `export * as ${k} from ${JSON.stringify(path.join(ws, p))};`).join('\n');
  try {
    const r = await build({
      stdin: { contents: entry, resolveDir: ws, loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: '__cand', platform: 'neutral',
      mainFields: ['module', 'main'], jsx: 'automatic', target: 'es2020', logLevel: 'silent',
      external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@radix-ui/*'],
      alias: { 'next/link': path.join(ws, 'shims/next-link.tsx'), '@line/construct-core/typed-contracts': path.join(ws, 'typed-contracts/index.ts') },
      plugins: [{ name: 'candidate', setup(b) { b.onLoad({ filter: /\.tsx?$/ }, (a) => (a.path === target ? { contents: body, loader: target.endsWith('.tsx') ? 'tsx' : 'ts' } : undefined)); } }],
    });
    return { ok: true, code: r.outputFiles[0].text };
  } catch (e) {
    return { ok: false, error: String(e?.errors?.[0]?.text ?? e?.message ?? e).split('\n')[0] };
  }
}

/** A plan sketch file (ESM `export function`) as a guest expression: an object of its functions. */
export function planModule(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/^export\s+(function|const)\s+/gm, '$1 ');
  const names = [...fs.readFileSync(file, 'utf8').matchAll(/^export\s+(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return `(() => {\n${src}\nreturn { ${names.join(', ')} };\n})()`;
}

/**
 * Run scenarios in one fresh QuickJS context: the candidate (when `bundle`), and the plan sketch (when `plan`, with
 * `planFn` naming its view function). Errors thrown by the candidate are returned per scenario, never thrown.
 */
export async function runScenarios({ bundle = null, plan = null, planFn = 'view', scenarios, books, kind, timeoutMs = 3000 }) {
  const code = `${GUEST_RUNTIME}
const __books = ${JSON.stringify(books)};
const __lib = {
  books: __books.map((b) => ({ ...b })),
  findBook: ({ id }) => __books.find((b) => b.id === id),
  listBooks: () => __books.map((b) => ({ ...b })),
  pickedBooks: ({ ids }) => ids.map((id) => __books.find((b) => b.id === id)).filter(Boolean),
};
const __scen = ${JSON.stringify(scenarios)};
const __out = { views: null, planViews: null, errors: [] };
${bundle ? `try {\n${bundle}\n} catch (e) { __out.loadError = (e && e.name || 'Error') + ': ' + (e && e.message); }` : ''}
${plan ? `let __plan = null; try { __plan = ${plan}; } catch (e) { __out.planLoadError = String(e && e.message); }` : ''}
const __safe = (f) => { try { return f(); } catch (e) { return { thrown: (e && e.name || 'Error') + ': ' + String(e && e.message).slice(0, 160) }; } };
if (${bundle ? 'true' : 'false'} && !__out.loadError) {
  const page = __cand.page ?? {};
  const C = Object.values(page).find((v) => typeof v === 'function') ?? page.default;
  __out.views = __scen.map((s) => __safe(() => (${JSON.stringify(kind)} === 'store' ? runStore(__cand.store, s) : runPage(C, s, __cand.store))));
}
if (${plan ? 'true' : 'false'} && __plan) __out.planViews = __scen.map((s) => __safe(() => __plan[${JSON.stringify(planFn)}](s, __lib)));
JSON.stringify(__out);`;
  const r = await evalGuest(code, { timeoutMs });
  if (!r.ok) return { ok: false, kind: r.timedOut ? 'timeout' : r.oom ? 'oom' : 'error', error: r.error, ms: r.ms };
  const out = JSON.parse(r.value);
  return { ok: true, ...out, ms: r.ms };
}

const isSubsequence = (want, got, eq) => { let j = 0; for (const g of got) if (j < want.length && eq(want[j], g)) j++; return j === want.length; };
/** The assertions of `expected` (a partial View) that `view` fails. */
export function match(expected, view) {
  const f = [];
  if (!view || view.thrown) return [`threw ${view?.thrown ?? 'nothing to read'}`];
  if (view.actionErrors?.length) f.push(...view.actionErrors);
  const text = view.text ?? [view.h1, ...(view.lines ?? []), ...(view.contains ?? []), ...(view.links ?? []).map((l) => l.text), ...(view.buttons ?? []).map((b) => b.text)].filter(Boolean).join(' ');
  if (expected.h1 !== undefined && view.h1 !== expected.h1) f.push(`h1 is ${JSON.stringify(view.h1)}, expected ${JSON.stringify(expected.h1)}`);
  if (expected.lines && !isSubsequence(expected.lines, view.lines ?? [], (a, b) => b.includes(a))) f.push(`lines ${JSON.stringify(expected.lines).slice(0, 120)} not shown in order`);
  for (const s of expected.contains ?? []) if (!text.includes(s)) f.push(`missing text ${JSON.stringify(s)}`);
  for (const s of expected.absent ?? []) if (new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) f.push(`shows ${JSON.stringify(s)}`);
  for (const [s, n] of Object.entries(expected.counts ?? {})) { const got = text.split(s).length - 1; if (got !== n) f.push(`${JSON.stringify(s)} ${got} times, expected ${n}`); }
  const bookLinks = (view.links ?? []).filter((l) => l.href.startsWith('/books/'));
  if (expected.bookLinks) {
    const want = expected.bookLinks.map((l) => `${l.text} -> ${l.href}`);
    const got = bookLinks.map((l) => `${l.text} -> ${l.href}`);
    const same = expected.unordered ? JSON.stringify([...want].sort()) === JSON.stringify([...got].sort()) : JSON.stringify(want) === JSON.stringify(got);
    if (!same) f.push(`book links ${got.length} ${JSON.stringify(got.slice(0, 3))}..., expected ${want.length} ${JSON.stringify(want.slice(0, 3))}...`);
  }
  if (expected.bookLinkCount !== undefined && bookLinks.length !== expected.bookLinkCount) f.push(`${bookLinks.length} book links, expected ${expected.bookLinkCount}`);
  for (const l of expected.links ?? []) if (!(view.links ?? []).some((x) => x.text === l.text && x.href === l.href)) f.push(`no link ${JSON.stringify(l.text)} to ${l.href}`);
  for (const b of expected.buttons ?? []) {
    const hit = (view.buttons ?? []).find((x) => x.text === b.text);
    if (!hit) f.push(`no button ${JSON.stringify(b.text)}`);
    else if (b.disabled !== undefined && hit.disabled !== b.disabled) f.push(`button ${JSON.stringify(b.text)} ${hit.disabled ? 'disabled' : 'enabled'}`);
  }
  for (const t of expected.noEnabledButton ?? []) if ((view.buttons ?? []).some((x) => x.text === t && !x.disabled)) f.push(`enabled button ${JSON.stringify(t)}`);
  for (const s of expected.selects ?? []) {
    const hit = (view.selects ?? []).find((x) => x.label === s.label);
    if (!hit) f.push(`no select labelled ${JSON.stringify(s.label)}`);
    else if (JSON.stringify(hit.options) !== JSON.stringify(s.options)) f.push(`select ${s.label} options ${JSON.stringify(hit.options)}`);
  }
  if (expected.picks !== undefined && JSON.stringify(view.picks) !== JSON.stringify(expected.picks)) f.push(`picks ${JSON.stringify(view.picks)}, expected ${JSON.stringify(expected.picks)}`);
  if (expected.lists !== undefined && JSON.stringify(view.lists) !== JSON.stringify(expected.lists)) f.push(`lists ${JSON.stringify(view.lists)}, expected ${JSON.stringify(expected.lists)}`);
  if (expected.stored !== undefined && JSON.stringify(view.stored) !== JSON.stringify(expected.stored)) f.push(`stored ${JSON.stringify(view.stored)}, expected ${JSON.stringify(expected.stored)}`);
  return f;
}
