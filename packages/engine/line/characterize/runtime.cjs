// iv2-tests -- the jest-side runtime of Line's characterization tests. Construct copies this file, unchanged apart from
// the generated-file marker on top, into the target app next to the tests it generates (line-char-runtime.js), so the
// locked tests need nothing from Construct to run: only jest, React Testing Library and React, which the app has.
//
// Three jobs:
//   1. Mocks the generated tests install: data hooks (`use*Query` / `use*Mutation`) answering from the scenario's state,
//      the Next.js router, and spies (calling through) on effect objects (toast, analytics), storage writes and props'
//      callbacks. Everything they do is recorded as an "effect", in order.
//   2. Running one scenario (a pure call, a hook or a component render followed by interaction steps) and observing it:
//      return value, rendered text, form values, the arguments the data hooks were last called with, and the effects.
//   3. The probe: a coverage-guided search, run once by Construct while generating. It samples inputs from the shapes
//      Construct read from the app's types, keeps every scenario that reaches code no earlier scenario reached (counters
//      in istanbul's `__coverage__`), mutates kept scenarios and explores the handlers a render exposes. The kept
//      scenarios become the locked tests; their observations, recorded in a second probe run, become the expectations.
'use strict';

// Loaded with the test file (not lazily inside a test): React Testing Library registers its own afterEach cleanup on load.
const RTL = require('@testing-library/react');

const S = {
  env: null,
  hooks: {},
  hookArgs: {},
  memo: new Map(),
  epoch: 0,
  effects: [],
  search: {},
  pathname: '/',
  router: null,
  restore: [],
  observers: [],
  winListeners: [],
  rng: null,
};

// ---- encoding (values that cross into generated source) ----------------------------------------------------------

function isElement(v) {
  return v && typeof v === 'object' && (v.$$typeof === Symbol.for('react.element') || v.$$typeof === Symbol.for('react.transitional.element'));
}

/** A JSON-safe, deterministic picture of any value (what a test compares). */
function encode(v, depth = 0, seen = new Set()) {
  if (v === undefined) return { $u: 1 };
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return { $nan: 1 };
    if (!Number.isFinite(v)) return { $inf: v > 0 ? 1 : -1 };
    if (Object.is(v, -0)) return 0;
    return v;
  }
  if (typeof v === 'bigint') return { $big: String(v) };
  if (typeof v === 'symbol') return { $sym: String(v.description ?? '') };
  if (typeof v === 'function') return { $fn: v.__lineName || v.name || 'anonymous' };
  if (depth > 8) return { $deep: 1 };
  if (isElement(v)) {
    const t = v.type;
    const name = typeof t === 'string' ? t : (t && (t.displayName || t.name)) || 'Component';
    return { $el: name };
  }
  if (typeof Node !== 'undefined' && v instanceof Node) return { $dom: v.nodeName };
  // DOM and React events: their type and target only (time stamps and coordinates are not behaviour)
  if ((typeof Event !== 'undefined' && v instanceof Event) || (v.nativeEvent && typeof v.preventDefault === 'function')) {
    const t = v.target || v.currentTarget;
    return { $event: String(v.type), target: t && t.nodeName ? t.nodeName : null };
  }
  if (typeof Window !== 'undefined' && v instanceof Window) return { $window: 1 };
  if (seen.has(v)) return { $cycle: 1 };
  seen.add(v);
  try {
    if (v instanceof Date) return { $date: Number.isNaN(v.getTime()) ? 'invalid' : v.toISOString() };
    if (v instanceof Error) return { $err: String(v.message) };
    if (v instanceof Set) return { $set: [...v].map((x) => encode(x, depth + 1, seen)) };
    if (v instanceof Map) return { $map: [...v].map(([k, x]) => [encode(k, depth + 1, seen), encode(x, depth + 1, seen)]) };
    if (typeof v.then === 'function') return { $promise: 1 };
    if (Array.isArray(v)) return v.map((x) => encode(x, depth + 1, seen));
    if (typeof URLSearchParams !== 'undefined' && v instanceof URLSearchParams) return { $qs: v.toString() };
    const out = {};
    for (const k of Object.keys(v)) out[k] = encode(v[k], depth + 1, seen);
    return out;
  } finally {
    seen.delete(v);
  }
}

/** The value an encoded input stands for (callbacks become recorded functions). */
function revive(v, key) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => revive(x, key));
  if (v.$u) return undefined;
  if (v.$nan) return NaN;
  if (v.$inf) return v.$inf * Infinity;
  if ('$fn' in v) return recorder(`prop:${v.$fn}`);
  if ('$set' in v) return new Set(v.$set.map((x) => revive(x)));
  if ('$map' in v) return new Map(v.$map.map(([k, x]) => [revive(k), revive(x)]));
  if ('$date' in v) return new Date(v.$date);
  if ('$dom' in v) return document.createElement(v.$dom);
  if ('$file' in v) {
    const f = v.$file;
    const file = new File(['x'], f.name, { type: f.type || '' });
    Object.defineProperty(file, 'size', { value: f.size });
    return file;
  }
  if ('$promise' in v) return Promise.resolve(revive(v.$promise));
  const out = {};
  for (const k of Object.keys(v)) {
    const x = revive(v[k], k);
    if (!(v[k] && typeof v[k] === 'object' && v[k].$u)) out[k] = x;
    else out[k] = undefined;
  }
  return out;
}

function recordEffect(name, args) {
  S.effects.push([name, encode(args)]);
}

/** A function that records its calls as effects under `name`. */
function recorder(name, ret) {
  const fn = function (...args) {
    recordEffect(name, args);
    return typeof ret === 'function' ? ret(...args) : ret;
  };
  fn.__lineName = name;
  return fn;
}

// ---- mocks the generated files install ---------------------------------------------------------------------------

function memo(key, build) {
  const k = `${S.epoch}|${key}`;
  if (!S.memo.has(k)) S.memo.set(k, build());
  return S.memo.get(k);
}

const UNINIT = { data: undefined, currentData: undefined, isLoading: false, isFetching: false, isError: false, isSuccess: false, isUninitialized: true, error: undefined };

function queryStub(name) {
  const stub = function (arg, opts) {
    S.hookArgs[name] = encode([arg, opts && typeof opts === 'object' ? { skip: opts.skip, pollingInterval: opts.pollingInterval } : opts]);
    const st = S.hooks[name];
    const skip = Boolean(opts && opts.skip);
    return memo(`${name}|${skip}|${S.hookEpoch?.[name] ?? 0}`, () => {
      const refetch = function () {
        recordEffect(`refetch:${name}`, []);
        const p = Promise.resolve({ data: st && !skip ? st.data : undefined });
        p.unwrap = () => p.then((r) => r.data);
        return p;
      };
      refetch.__lineName = `refetch:${name}`;
      if (skip || !st) return { ...UNINIT, refetch };
      const isError = Boolean(st.isError);
      return {
        data: st.data,
        currentData: st.cur === false ? undefined : st.data,
        isLoading: Boolean(st.isLoading),
        isFetching: Boolean(st.isFetching),
        isError,
        isSuccess: st.data !== undefined && !isError,
        isUninitialized: false,
        error: isError ? { status: 500, data: { message: 'error' } } : undefined,
        fulfilledTimeStamp: st.ts === undefined ? 1 : st.ts,
        refetch,
      };
    });
  };
  stub.__lineName = name;
  return stub;
}

function mutationStub(name, lazy) {
  const stub = function () {
    S.hookArgs[name] = encode([]);
    const st = S.hooks[name] || {};
    return memo(`${name}|${S.hookEpoch?.[name] ?? 0}`, () => {
      const trigger = function (arg) {
        recordEffect(`${lazy ? 'lazy' : 'mutation'}:${name}`, [arg]);
        const p = st.ok === false ? Promise.reject({ status: 500, data: { message: 'error' } }) : Promise.resolve(st.data === undefined ? {} : st.data);
        p.catch(() => {});
        const r = lazy ? p.then((d) => ({ data: d })) : p.then((d) => ({ data: d }), (e) => ({ error: e }));
        r.unwrap = () => p;
        r.abort = () => {};
        return r;
      };
      trigger.__lineName = name;
      const state = { isLoading: false, isError: false, isSuccess: false, data: undefined, reset() {} };
      return lazy ? [trigger, { ...UNINIT }, { lastArg: undefined }] : [trigger, state];
    });
  };
  stub.__lineName = name;
  return stub;
}

/** A module with its data hooks replaced by scenario-driven stubs: `jest.mock(path, () => hookModuleMock(actual, {name: kind}))`. */
function hookModuleMock(actual, hooks) {
  const out = Object.assign({}, actual);
  for (const [name, kind] of Object.entries(hooks)) out[name] = kind === 'query' ? queryStub(name) : mutationStub(name, kind === 'lazy');
  return out;
}

/** `next/navigation` for tests: the router records its calls; the pathname and search params come from the scenario. */
function nextNavigationMock() {
  const routerMethod = (m) => recorder(`router.${m}`);
  return {
    __esModule: true,
    useRouter: () => memo('router', () => ({ push: routerMethod('push'), replace: routerMethod('replace'), back: routerMethod('back'), forward: routerMethod('forward'), refresh: routerMethod('refresh'), prefetch: () => Promise.resolve() })),
    usePathname: () => S.pathname,
    useSearchParams: () => memo('search', () => new URLSearchParams(S.search)),
    useParams: () => memo('params', () => ({})),
    useSelectedLayoutSegment: () => null,
    useSelectedLayoutSegments: () => [],
    redirect: recorder('router.redirect'),
    permanentRedirect: recorder('router.permanentRedirect'),
    notFound: recorder('router.notFound'),
  };
}

// ---- environment: polyfills, spies, determinism ------------------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let polyfilled = false;
function polyfill() {
  if (polyfilled || typeof window === 'undefined') return;
  polyfilled = true;
  const noop = () => {};
  if (!window.matchMedia) window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false });
  class RO {
    constructor(cb) { this.cb = cb; this.targets = []; }
    observe(t) { this.targets.push(t); S.observers.push({ kind: 'resize', ob: this, el: t }); }
    unobserve(t) { this.targets = this.targets.filter((x) => x !== t); S.observers = S.observers.filter((o) => !(o.ob === this && o.el === t)); }
    disconnect() { this.targets = []; S.observers = S.observers.filter((o) => o.ob !== this); }
  }
  class IO extends RO {
    constructor(cb, opts) { super(cb); this.root = (opts && opts.root) || null; this.rootMargin = ''; this.thresholds = [0]; }
    observe(t) { this.targets.push(t); S.observers.push({ kind: 'intersect', ob: this, el: t }); }
    takeRecords() { return []; }
  }
  window.ResizeObserver = RO;
  window.IntersectionObserver = IO;
  global.ResizeObserver = RO;
  global.IntersectionObserver = IO;
  if (!window.PointerEvent) {
    class PE extends MouseEvent {
      constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse'; }
    }
    window.PointerEvent = PE;
    global.PointerEvent = PE;
  }
  // jsdom's selector engine fails on selectors browsers accept: escaped characters in class names (Tailwind's
  // `.group\\/name`) and `:scope` on an element whose class has such characters; on that error, retry in a form it reads
  const classAttr = (sel) => sel.replace(/\.((?:[\w-]|\\.)+)/g, (m, tok) => (tok.includes('\\') ? `[class~="${tok.replace(/\\(.)/g, '$1')}"]` : m));
  for (const proto of [window.Element.prototype, window.Document.prototype, window.DocumentFragment.prototype]) {
    for (const name of ['querySelector', 'querySelectorAll', 'matches', 'closest']) {
      const orig = proto[name];
      if (typeof orig !== 'function') continue;
      proto[name] = function (sel, ...rest) {
        try { return orig.call(this, sel, ...rest); } catch (e) {
          if (typeof sel !== 'string') throw e;
          if (sel.includes(':scope') && this.setAttribute) {
            // jsdom rewrites `:scope` with the element's own class names and fails on characters like `/`; mark the
            // element instead, as the browser's `:scope` refers to it
            this.setAttribute('data-line-scope', '');
            try { return orig.call(this, sel.split(':scope').join('[data-line-scope]'), ...rest); } finally { this.removeAttribute('data-line-scope'); }
          }
          if (!sel.includes('\\')) throw e;
          return orig.call(this, classAttr(sel), ...rest);
        }
      };
    }
  }
  const EP = window.Element.prototype;
  if (!EP.scrollIntoView) EP.scrollIntoView = noop;
  if (!EP.hasPointerCapture) { EP.hasPointerCapture = () => false; EP.setPointerCapture = noop; EP.releasePointerCapture = noop; }
  if (!EP.scrollTo) EP.scrollTo = noop;
  window.scrollTo = noop;
  if (!global.URL.createObjectURL) global.URL.createObjectURL = () => 'blob:line';
  if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = noop;
  // listeners the closure adds on window/document: each becomes something a step can dispatch
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = function (type, fn, opts) {
      S.winListeners.push({ target, type });
      return add(type, fn, opts);
    };
    target.removeEventListener = function (type, fn, opts) {
      return remove(type, fn, opts);
    };
  }
}

function wrapMethod(obj, method, label) {
  if (!obj || typeof obj[method] !== 'function') return;
  const orig = obj[method];
  const wrapped = function (...args) {
    recordEffect(label, args);
    return orig.apply(this, args);
  };
  wrapped.__lineName = label;
  try {
    obj[method] = wrapped;
    S.restore.push(() => { obj[method] = orig; });
  } catch (e) {
    /* a frozen object: its calls are not recorded */
  }
}

/** Before each scenario: fresh state, fake timers at a fixed time, a seeded Math.random, spies installed. */
function beforeEachScenario(env) {
  polyfill();
  S.env = env;
  S.effects = [];
  S.hookArgs = {};
  S.memo = new Map();
  S.hookEpoch = {};
  S.epoch += 1;
  S.observers = [];
  S.winListeners = [];
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-01-15T10:00:00.000Z'));
  const rnd = mulberry32(42);
  const origRandom = Math.random;
  Math.random = rnd;
  S.restore.push(() => { Math.random = origRandom; });
  for (const c of ['error', 'warn', 'log', 'info', 'debug']) {
    const orig = console[c];
    console[c] = () => {};
    S.restore.push(() => { console[c] = orig; });
  }
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch (e) { /* no storage */ }
  // an error thrown inside an event listener is behaviour: recorded, not a crash of the test
  const onError = (e) => { recordEffect('uncaught', [String((e.error && e.error.message) || e.message || '')]); e.preventDefault(); };
  window.addEventListener('error', onError);
  S.restore.push(() => window.removeEventListener('error', onError));
  wrapMethod(window.Storage.prototype, 'setItem', 'storage.setItem');
  wrapMethod(window.Storage.prototype, 'removeItem', 'storage.removeItem');
  wrapMethod(window.Storage.prototype, 'clear', 'storage.clear');
  for (const [get, exportName, method] of env.spies || []) {
    let mod;
    try { mod = get(); } catch (e) { continue; }
    const obj = exportName === '*' ? mod : mod && mod[exportName];
    wrapMethod(obj, method, `${exportName}.${method}`);
  }
}

function afterEachScenario() {
  try { RTL.cleanup(); } catch (e) { /* nothing rendered */ }
  try { jest.clearAllTimers(); } catch (e) { /* real timers */ }
  jest.useRealTimers();
  while (S.restore.length) S.restore.pop()();
}

// ---- running and observing one scenario --------------------------------------------------------------------------

const EVENTS = {
  onClick: 'click', onDoubleClick: 'dblClick', onContextMenu: 'contextMenu', onMouseDown: 'mouseDown', onMouseUp: 'mouseUp',
  onMouseEnter: 'mouseEnter', onMouseLeave: 'mouseLeave', onMouseOver: 'mouseOver', onMouseOut: 'mouseOut', onMouseMove: 'mouseMove',
  onPointerDown: 'pointerDown', onPointerUp: 'pointerUp', onPointerEnter: 'pointerEnter', onPointerLeave: 'pointerLeave', onPointerMove: 'pointerMove',
  onFocus: 'focus', onBlur: 'blur', onKeyDown: 'keyDown', onKeyUp: 'keyUp', onKeyPress: 'keyPress', onChange: 'change', onInput: 'input',
  onSubmit: 'submit', onScroll: 'scroll', onWheel: 'wheel', onDragStart: 'dragStart', onDragEnd: 'dragEnd', onDragOver: 'dragOver', onDragEnter: 'dragEnter',
  onDragLeave: 'dragLeave', onDrop: 'drop', onTouchStart: 'touchStart', onTouchEnd: 'touchEnd', onTouchMove: 'touchMove', onAnimationEnd: 'animationEnd',
  onTransitionEnd: 'transitionEnd', onPaste: 'paste', onCopy: 'copy', onSelect: 'select', onLoad: 'load', onError: 'error',
};
const KEYS = ['Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'Tab', ' ', 'Backspace', 'a'];

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const srcKeys = new WeakMap();
/** Which handler this is in the source (the same arrow on every card has the same text), for exploring each once. */
function srcKey(fn) {
  if (srcKeys.has(fn)) return srcKeys.get(fn);
  const text = Function.prototype.toString.call(fn);
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  const k = `${fn.name || 'fn'}#${(h >>> 0).toString(36)}`;
  srcKeys.set(fn, k);
  return k;
}

function sigOf(el, ev) {
  if (el === window) return `${ev}|window`;
  if (el === document) return `${ev}|document`;
  const label = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('role') || el.getAttribute('name') || '');
  return `${ev}|${el.tagName ? el.tagName.toLowerCase() : '?'}|${label || ''}|${norm(el.textContent).slice(0, 40)}`;
}

/** Everything a step can act on now: React handlers in the DOM (portals included), observers and window listeners. */
function targets() {
  const out = [];
  if (typeof document === 'undefined') return out;
  for (const el of document.body.querySelectorAll('*')) {
    const pk = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    if (!pk) continue;
    const props = el[pk] || {};
    for (const name of Object.keys(props)) if (EVENTS[name] && typeof props[name] === 'function') out.push({ el, ev: name, src: srcKey(props[name]) });
  }
  for (const o of S.observers) if (o.el && o.el.isConnected) out.push({ el: o.el, ev: o.kind === 'intersect' ? 'intersect' : 'resize', ob: o.ob });
  const seenWin = new Set();
  for (const l of S.winListeners) {
    const key = `${l.target === window ? 'window' : 'document'}:${l.type}`;
    if (seenWin.has(key) || /^(error|unhandledrejection|DOMContentLoaded|load|message)$/.test(l.type)) continue;
    seenWin.add(key);
    out.push({ el: l.target, ev: `win:${l.type}` });
  }
  return out.map((t) => ({ ...t, sig: sigOf(t.el, t.ev) }));
}

function find(step) {
  const all = targets().filter((t) => t.sig === step.sig);
  return all[step.n || 0] || null;
}

async function settle(ms = 400) {
  const { act } = RTL;
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      jest.advanceTimersByTime(ms / 4);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function fire(t, step) {
  const { fireEvent, act } = RTL;
  const el = t.el;
  if (step.ev === 'intersect' || step.ev === 'resize') {
    await act(async () => {
      t.ob.cb([{ target: el, isIntersecting: step.v !== false, intersectionRatio: step.v === false ? 0 : 1, contentRect: { width: 800, height: 600, top: 0, left: 0 }, boundingClientRect: { width: 800, height: 600 } }], t.ob);
    });
    return;
  }
  if (step.ev.startsWith('win:')) {
    const type = step.ev.slice(4);
    const init = /^key/.test(type) ? { key: step.v || 'Escape', bubbles: true } : { bubbles: true };
    const E = /^key/.test(type) ? KeyboardEvent : /^(mouse|click|pointer)/.test(type) ? MouseEvent : Event;
    // dispatched from the body so it bubbles to document and window listeners with an element as its target
    await act(async () => { document.body.dispatchEvent(new E(type, init)); });
    return;
  }
  const kind = EVENTS[step.ev];
  if (kind === 'change' || kind === 'input') {
    if (el.type === 'checkbox' || el.type === 'radio') fireEvent.click(el);
    else fireEvent[kind](el, { target: { value: step.v === undefined ? '' : String(step.v) } });
  } else if (/^key/.test(kind)) {
    fireEvent[kind](el, { key: step.v || 'Enter', code: step.v || 'Enter' });
  } else if (/^pointer/.test(kind)) {
    fireEvent[kind](el, { button: 0, ctrlKey: false, pointerType: 'mouse', pointerId: 1 });
  } else if (kind === 'scroll') {
    try { el.scrollTop = Number(step.v) || 500; } catch (e) { /* read-only */ }
    fireEvent.scroll(el);
  } else if (fireEvent[kind]) {
    fireEvent[kind](el);
  }
}

/** The page as a test sees it: rendered text, form values, the data hooks' last arguments. */
function snapshotDom(prevText) {
  const text = typeof document === 'undefined' ? '' : norm(document.body.textContent);
  const values = typeof document === 'undefined' ? [] : [...document.body.querySelectorAll('input,textarea,select')].map((e) => (e.type === 'checkbox' || e.type === 'radio' ? Boolean(e.checked) : e.value));
  const o = {};
  if (text !== prevText) o.text = text;
  if (values.length) o.values = values;
  return { o, text };
}

function takeEffects() {
  const e = S.effects;
  S.effects = [];
  return e;
}

function wrapperFor(env) {
  const React = require('react');
  const hosts = (env.hosts || []).map((get) => { try { return get(); } catch (e) { return null; } }).filter(Boolean);
  return function LineCharHost({ children }) {
    return React.createElement(React.Fragment, null, children, ...hosts.map((H, i) => React.createElement(H, { key: `line-host-${i}` })));
  };
}

function renderWith(env, ui) {
  const rtl = RTL;
  const helper = env.renderHelper ? (() => { try { return env.renderHelper(); } catch (e) { return null; } })() : null;
  const React = require('react');
  const Host = wrapperFor(env);
  const wrapped = React.createElement(Host, null, ui);
  if (helper) {
    const r = helper(wrapped);
    return { rerender: (next) => r.rerender(React.createElement(Host, null, next)), unmount: r.unmount };
  }
  const r = rtl.render(wrapped);
  return { rerender: (next) => r.rerender(React.createElement(Host, null, next)), unmount: r.unmount };
}

function setScenarioState(sc) {
  S.hooks = {};
  for (const [k, v] of Object.entries(sc.hooks || {})) S.hooks[k] = revive(v);
  S.search = sc.search || {};
  S.pathname = (S.env && S.env.pathname) || '/';
  for (const [k, v] of Object.entries(sc.storage || {})) { try { window.localStorage.setItem(k, v); } catch (e) { /* no storage */ } }
  S.effects = [];
}

async function applyStep(ctx, step) {
  const { act } = RTL;
  if (step.ev === 'tick') {
    const ms = step.v || 5000;
    // a long wait moves the clock without running every frame and interval in between
    if (ms > 60000) jest.setSystemTime(Date.now() + ms);
    await act(async () => { jest.advanceTimersByTime(Math.min(ms, 60000)); await Promise.resolve(); });
    return true;
  }
  if (step.ev === 'hook') {
    S.hooks[step.name] = revive(step.state);
    S.hookEpoch[step.name] = (S.hookEpoch[step.name] || 0) + 1;
    await act(async () => { ctx.rerender(); });
    return true;
  }
  if (step.ev === 'props') {
    ctx.props = revive(step.props);
    await act(async () => { ctx.rerender(); });
    return true;
  }
  if (step.ev === 'remount') {
    // leave and come back: unmount (cleanup effects run), then render again with what storage now holds
    await act(async () => { ctx.unmount(); });
    await act(async () => { ctx.mount(); });
    return true;
  }
  const t = find(step);
  if (!t) return false;
  await fire(t, step);
  return true;
}

function errorText(e) {
  return String((e && e.message) || e).split('\n')[0].slice(0, 300);
}

/**
 * Run one scenario and return what it did. With `explore`, after the scenario's own steps it takes up to `explore.count`
 * more steps chosen from what the render exposes (appended to `sc.steps`, so the scenario stays replayable).
 */
async function runScenario(kind, subject, sc, explore) {
  setScenarioState(sc);
  const obs = [];
  if (kind === 'pure') {
    let ret;
    try {
      ret = subject(...revive(sc.args || []));
      if (ret && typeof ret.then === 'function') {
        let settled = false; let val; let err;
        ret.then((v) => { settled = true; val = v; }, (e) => { settled = true; err = e; });
        for (let i = 0; i < 5 && !settled; i++) { await Promise.resolve(); jest.advanceTimersByTime(100); }
        ret = settled ? (err ? { $rejects: errorText(err) } : { $resolves: encode(val) }) : { $pending: 1 };
        obs.push({ ret, effects: takeEffects() });
      } else obs.push({ ret: encode(ret), effects: takeEffects() });
    } catch (e) {
      obs.push({ throws: errorText(e), effects: takeEffects() });
    }
    return obs;
  }
  const React = require('react');
  const ctx = { props: sc.props ? revive(sc.props) : {} };
  let r;
  const Probe = function LineHookProbe() {
    ctx.result = subject(...revive(sc.args || []));
    return null;
  };
  const element = () => (kind === 'hook' ? React.createElement(Probe) : React.createElement(subject, ctx.props));
  ctx.mount = () => { r = renderWith(S.env, element()); };
  ctx.unmount = () => { r.unmount(); };
  ctx.rerender = () => r.rerender(element());
  try {
    ctx.mount();
    await settle();
  } catch (e) {
    obs.push({ at: 'render', error: errorText(e), effects: takeEffects() });
    return obs;
  }
  let prevText;
  const observe = (at) => {
    const snap = snapshotDom(prevText);
    prevText = snap.text;
    const o = { at, ...snap.o, hookArgs: encode(S.hookArgs), effects: takeEffects() };
    if (kind === 'hook') o.result = encode(ctx.result);
    obs.push(o);
  };
  observe('render');
  const steps = sc.steps || (sc.steps = []);
  const report = (n) => { if (explore && explore.onTargets) explore.onTargets(sc, steps.slice(0, n)); };
  report(0);
  for (let i = 0; i < steps.length; i++) {
    let ok;
    try { ok = await applyStep(ctx, steps[i]); await settle(); } catch (e) { obs.push({ at: `step ${i}`, error: errorText(e), effects: takeEffects() }); return obs; }
    if (!ok) { obs.push({ at: `step ${i}`, missing: steps[i].sig }); return obs; }
    observe(`step ${i}`);
    report(i + 1);
  }
  if (explore) {
    for (let j = 0; j < explore.count; j++) {
      const step = explore.next(ctx);
      if (!step) break;
      steps.push(step);
      try { await applyStep(ctx, step); await settle(); } catch (e) { obs.push({ at: `step ${steps.length - 1}`, error: errorText(e), effects: takeEffects() }); return obs; }
      observe(`step ${steps.length - 1}`);
      report(steps.length);
    }
  }
  try {
    const { act } = RTL;
    await act(async () => { r.unmount(); });
    obs.push({ at: 'unmount', effects: takeEffects() });
  } catch (e) {
    obs.push({ at: 'unmount', error: errorText(e) });
  }
  return obs;
}

/** The locked test's body: replay the scenario and compare with what was recorded when it was generated. */
async function expectScenario(kind, getSubject, sc, expected) {
  const subject = getSubject();
  const actual = await runScenario(kind, subject, JSON.parse(JSON.stringify(sc)));
  expect(actual).toEqual(expected);
}

// ---- probe: coverage-guided search -------------------------------------------------------------------------------

function coverage() {
  return global.__coverage__ || {};
}

function snapCounters() {
  const out = {};
  const cov = coverage();
  for (const f of Object.keys(cov)) out[f] = { s: { ...cov[f].s }, f: { ...cov[f].f }, b: Object.fromEntries(Object.entries(cov[f].b).map(([k, a]) => [k, a.slice()])) };
  return out;
}

function hitsSince(before) {
  const hits = [];
  const cov = coverage();
  for (const f of Object.keys(cov)) {
    const b0 = before[f] || { s: {}, f: {}, b: {} };
    for (const [k, n] of Object.entries(cov[f].s)) if (n > (b0.s[k] || 0)) hits.push(`${f}|s|${k}`);
    for (const [k, n] of Object.entries(cov[f].f)) if (n > (b0.f[k] || 0)) hits.push(`${f}|f|${k}`);
    for (const [k, arr] of Object.entries(cov[f].b)) arr.forEach((n, i) => { if (n > ((b0.b[k] || [])[i] || 0)) hits.push(`${f}|b|${k}|${i}`); });
  }
  return hits;
}

/** Every counter's location in the original source (istanbul inside jest counts in the transpiled file). */
function remappedMaps(rootDir) {
  let TraceMap; let originalPositionFor;
  try { ({ TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping')); } catch (e) { TraceMap = null; }
  const out = {};
  const cov = coverage();
  for (const f of Object.keys(cov)) {
    const fc = cov[f];
    const tm = TraceMap && fc.inputSourceMap ? new TraceMap(fc.inputSourceMap) : null;
    const pos = (p) => {
      if (!p || p.line === undefined) return null;
      if (!tm) return { line: p.line, column: p.column };
      const o = originalPositionFor(tm, { line: p.line, column: p.column });
      return o && o.line != null ? { line: o.line, column: o.column } : null;
    };
    const loc = (l) => (l ? { start: pos(l.start), end: pos(l.end) } : null);
    out[require('path').relative(rootDir, f).split(require('path').sep).join('/')] = {
      key: f,
      statementMap: Object.fromEntries(Object.entries(fc.statementMap).map(([k, l]) => [k, loc(l)])),
      fnMap: Object.fromEntries(Object.entries(fc.fnMap).map(([k, d]) => [k, { name: d.name, loc: loc(d.loc), decl: loc(d.decl) }])),
      branchMap: Object.fromEntries(Object.entries(fc.branchMap).map(([k, d]) => [k, { type: d.type, loc: loc(d.loc), locations: d.locations.map(loc) }])),
    };
  }
  return out;
}

// sampling ---------------------------------------------------------------------------------------------------------

function sampler(input) {
  const rng = mulberry32(input.seed || 7);
  const pick = (xs) => xs[Math.floor(rng() * xs.length)];
  const chance = (p) => rng() < p;
  const shapes = input.shapes || {};
  const pools = input.pools || { strings: [], numbers: [], byKey: {} };
  const GEN_STR = ['', 'a', 'Test', 'x-1', '123', 'some text', 'A b C', 'ok', '0', 'null'];
  const GEN_NUM = [0, 1, -1, 2, 0.5, 3, 10, 50, 99.5, 100, 101, 999, 1000, 1500, 12345, 999999, 1000000, 2500000, 1e9, 2.5e9, -1000];
  const dyn = { ids: [] };
  const deref = (s) => (s && s.k === 'ref' ? shapes[s.id] || { k: 'any' } : s);

  function str(key) {
    const kp = (pools.byKey[key] || []).filter((x) => typeof x === 'string');
    const r = rng();
    if (kp.length && r < 0.5) return pick(kp);
    if (key && /(^id$|Id$|_id$|ids?$)/.test(key) && r < 0.75) { const v = dyn.ids.length && chance(0.5) ? pick(dyn.ids) : `id-${1 + Math.floor(rng() * 4)}`; dyn.ids.push(v); return v; }
    if (pools.strings.length && r < 0.8) return pick(pools.strings);
    return pick(GEN_STR);
  }
  function num(key) {
    const kp = (pools.byKey[key] || []).filter((x) => typeof x === 'number');
    const r = rng();
    if (kp.length && r < 0.45) return pick(kp);
    if (pools.numbers.length && r < 0.65) return pick(pools.numbers);
    return pick(GEN_NUM);
  }
  function gen(shape, key, depth = 0) {
    const s = deref(shape);
    switch (s.k) {
      case 'str': return str(key);
      case 'num': return num(key);
      case 'bool': return chance(0.5);
      case 'lit': return s.v;
      case 'null': return null;
      case 'undef': return { $u: 1 };
      case 'union': {
        const solid = s.of.filter((x) => x.k !== 'undef' && x.k !== 'null');
        const r = rng();
        if (solid.length && solid.length < s.of.length && r < 0.2) return gen(pick(s.of.filter((x) => x.k === 'undef' || x.k === 'null')), key, depth);
        return gen(pick(solid.length ? solid : s.of), key, depth);
      }
      case 'arr': {
        const n = depth > 6 ? (chance(0.7) ? 0 : 1) : pick([0, 1, 1, 2, 2, 3, 4]);
        return Array.from({ length: n }, () => gen(s.of, key, depth + 1));
      }
      case 'tuple': return s.of.map((x) => gen(x, key, depth + 1));
      case 'set': return { $set: Array.from({ length: pick([0, 1, 1, 2, 3]) }, () => gen(s.of, key, depth + 1)) };
      case 'map': return { $map: Array.from({ length: pick([0, 1, 2]) }, () => [gen(s.key, key, depth + 1), gen(s.val, key, depth + 1)]) };
      case 'date': return { $date: pick(['2026-01-01T00:00:00.000Z', '2025-06-15T12:30:00.000Z', '2024-12-31T23:59:59.000Z']) };
      case 'fn': return { $fn: key || 'fn' };
      case 'node': return chance(0.5) ? str(key) : null;
      case 'dom': return { $dom: 'div' };
      case 'file': return { $file: { name: pick(['data.csv', 'report.xls', 'image.png', 'notes.txt', 'big.csv']), size: pick([0, 100, 5 * 1024 * 1024, 10 * 1024 * 1024 + 1, 20 * 1024 * 1024]), type: pick(['text/csv', 'application/vnd.ms-excel', 'image/png', '']) } };
      case 'promise': return { $promise: gen(s.of, key, depth + 1) };
      case 'obj': {
        const o = {};
        for (const p of s.props) {
          if (p.opt && (chance(depth > 5 ? 0.6 : 0.25))) continue;
          o[p.n] = gen(p.s, p.n, depth + 1);
        }
        if (s.idx && chance(0.6)) {
          const keys = (pools.byKey[key] || pools.strings).filter((x) => typeof x === 'string');
          for (let i = 0; i < pick([1, 2]); i++) { const k = keys.length ? pick(keys) : `k${i}`; o[k] = gen(s.idx, k, depth + 1); }
        }
        return o;
      }
      case 'any':
      default: {
        const r = rng();
        if (r < 0.3) return str(key);
        if (r < 0.5) return num(key);
        if (r < 0.6) return chance(0.5);
        if (r < 0.7) return null;
        if (r < 0.8) return { $u: 1 };
        return depth > 4 ? {} : (chance(0.5) ? {} : []);
      }
    }
  }
  function mut(v, shape, key, depth = 0) {
    const s = deref(shape);
    if (chance(0.25) || v === undefined) return gen(s, key, depth);
    if (s.k === 'obj' && v && typeof v === 'object' && !Array.isArray(v)) {
      const o = { ...v };
      const p = pick(s.props.length ? s.props : [{ n: '_', s: { k: 'any' }, opt: true }]);
      if (p.opt && p.n in o && chance(0.2)) delete o[p.n];
      else o[p.n] = mut(o[p.n], p.s, p.n, depth + 1);
      return o;
    }
    if (s.k === 'arr' && Array.isArray(v)) {
      const a = v.slice();
      const r = rng();
      if (r < 0.3 || !a.length) a.push(gen(s.of, key, depth + 1));
      else if (r < 0.45) a.pop();
      else if (r < 0.55) a.push(JSON.parse(JSON.stringify(a[0])));
      else { const i = Math.floor(rng() * a.length); a[i] = mut(a[i], s.of, key, depth + 1); }
      return a;
    }
    if (s.k === 'set' && v && v.$set) return { $set: mut(v.$set, { k: 'arr', of: s.of }, key, depth) };
    if (s.k === 'union') {
      const solid = s.of.filter((x) => x.k !== 'undef' && x.k !== 'null');
      if (solid.length === 1 && v && typeof v === 'object' && !v.$u) return mut(v, solid[0], key, depth);
    }
    return gen(s, key, depth);
  }
  return { rng, pick, chance, gen, mut, dyn, str, num };
}

function hookState(sm, h) {
  if (h.kind === 'mutation' || h.kind === 'lazy') return { ok: sm.chance(0.7), data: sm.chance(0.5) ? sm.gen(h.data, 'data') : { $u: 1 } };
  return {
    data: sm.chance(0.12) ? { $u: 1 } : sm.gen(h.data, 'data'),
    cur: sm.chance(0.85),
    isLoading: sm.chance(0.12),
    isFetching: sm.chance(0.2),
    isError: sm.chance(0.12),
    ts: sm.pick([1, 2, 3]),
  };
}

function genScenario(sm, input) {
  const sub = input.subject;
  if (sub.kind === 'pure') {
    const sc = { args: sub.params.map((p, i) => sm.gen(p, sub.paramNames ? sub.paramNames[i] : undefined)) };
    if ((input.storageKeys || []).length) sc.storage = genStorage(sm, input);
    return sc;
  }
  const sc = { steps: [] };
  if (sub.kind === 'hook') sc.args = sub.params.map((p) => sm.gen(p));
  if (sub.kind === 'component' && sub.props) sc.props = sm.gen(sub.props, 'props');
  sc.hooks = {};
  for (const [name, h] of Object.entries(input.hooks || {})) if (sm.chance(0.9)) sc.hooks[name] = hookState(sm, h);
  const search = {};
  for (const k of input.searchKeys || []) {
    if (sm.chance(0.5)) continue;
    const pool = (input.pools.byKey[`search:${k}`] || []).map(String);
    if (pool.length && sm.chance(0.8)) search[k] = Array.from({ length: sm.pick([1, 1, 2, 3]) }, () => sm.pick(pool)).join(',');
    else search[k] = sm.dyn.ids.length && sm.chance(0.6) ? sm.pick(sm.dyn.ids) : sm.str(k);
  }
  sc.search = search;
  sc.storage = genStorage(sm, input);
  return sc;
}

function genStorage(sm, input) {
  const storage = {};
  for (const k of input.storageKeys || []) {
    if (sm.chance(0.5)) continue;
    const pool = (input.pools.byKey[`storage:${k}`] || []).map(String);
    storage[k] = pool.length ? sm.pick(pool) : sm.str(k);
  }
  return storage;
}

function mutateScenario(sm, input, base) {
  const sc = JSON.parse(JSON.stringify(base));
  const sub = input.subject;
  if (sub.kind === 'pure') {
    if (sc.storage && sm.chance(0.2)) { sc.storage = genStorage(sm, input); return sc; }
    const i = Math.floor(sm.rng() * Math.max(1, sub.params.length));
    if (sub.params.length) sc.args[i] = sm.mut(sc.args[i], sub.params[i], sub.paramNames ? sub.paramNames[i] : undefined);
    return sc;
  }
  const choices = [];
  if (sc.props) choices.push('props');
  if (sc.args && sc.args.length) choices.push('args');
  const hookNames = Object.keys(input.hooks || {});
  if (hookNames.length) choices.push('hook', 'hook');
  if ((input.searchKeys || []).length) choices.push('search');
  if ((input.storageKeys || []).length) choices.push('storage');
  choices.push('steps', 'steps');
  const what = sm.pick(choices);
  if (what === 'props') sc.props = sm.mut(sc.props, sub.props, 'props');
  if (what === 'args') { const i = Math.floor(sm.rng() * sc.args.length); sc.args[i] = sm.mut(sc.args[i], sub.params[i]); }
  if (what === 'hook') {
    const name = sm.pick(hookNames);
    const h = input.hooks[name];
    const cur = sc.hooks[name];
    if (!cur || sm.chance(0.3)) sc.hooks[name] = hookState(sm, h);
    else if (h.kind === 'query') {
      const f = sm.pick(['data', 'data', 'data', 'cur', 'isLoading', 'isFetching', 'isError', 'ts', 'drop']);
      if (f === 'data') cur.data = sm.mut(cur.data && cur.data.$u ? undefined : cur.data, h.data, 'data');
      else if (f === 'ts') cur.ts = sm.pick([1, 2, 3]);
      else if (f === 'drop') delete sc.hooks[name];
      else cur[f] = !cur[f];
    } else cur.ok = !cur.ok;
  }
  if (what === 'search' || what === 'storage') {
    const fresh = genScenario(sm, input);
    const k = sm.pick(what === 'search' ? input.searchKeys : input.storageKeys);
    if (k in fresh[what]) sc[what][k] = fresh[what][k];
    else delete sc[what][k];
  }
  if (what === 'steps') sc.steps = sc.steps.slice(0, Math.floor(sm.rng() * (sc.steps.length + 1)));
  else if (sm.chance(0.5)) sc.steps = sc.steps.slice(0, Math.floor(sm.rng() * (sc.steps.length + 1)));
  return sc;
}

/** A step that acts on target `t` (the `n`th with its signature), with a value for inputs and keys. */
function stepFor(sm, input, t, n) {
  const step = { ev: t.ev, sig: t.sig };
  if (n > 0) step.n = n;
  const kind = EVENTS[t.ev];
  if (kind === 'change' || kind === 'input') {
    const r = sm.rng();
    const words = r < 0.35 ? norm(document.body.textContent).split(' ').filter((w) => w.length > 2) : [];
    if (words.length) {
      const w = sm.pick(words);
      step.v = sm.chance(0.5) ? w : w.slice(0, Math.max(1, Math.floor(w.length / 2)));
    } else step.v = sm.pick(input.inputValues);
  }
  if (/^key/.test(kind || '') || /^win:key/.test(t.ev)) step.v = sm.pick(input.keyValues);
  if (t.ev === 'intersect' && sm.chance(0.2)) step.v = false;
  return step;
}

/** A target's kind for breadth-first exploration: event, tag, label and the handler's source; never the (data-dependent) text. */
function coarseOf(t) {
  const [ev, tag, label] = t.sig.split('|');
  return t.src ? `${ev}|${tag}|${label}|${t.src}` : `${ev}|${tag}|${label}`;
}

function explorer(sm, input, fired) {
  return (ctx) => {
    const sub = input.subject;
    const r = sm.rng();
    const hookNames = Object.keys(input.hooks || {});
    if (r < 0.12 && hookNames.length) {
      const name = sm.pick(hookNames);
      const h = input.hooks[name];
      const base = S.hooks[name] ? JSON.parse(JSON.stringify(encode(S.hooks[name]))) : hookState(sm, h);
      let state = base;
      if (h.kind === 'query') {
        state = { ...base };
        const f = sm.pick(['data', 'data', 'isFetching', 'isError', 'ts']);
        if (f === 'data') state.data = sm.mut(base.data && base.data.$u ? undefined : base.data, h.data, 'data');
        else if (f === 'ts') state.ts = (base.ts || 1) + 1;
        else state[f] = !base[f];
        delete state.refetch;
      } else state = hookState(sm, h);
      return { ev: 'hook', name, state: stripFns(state) };
    }
    if (r < 0.17) return { ev: 'tick', v: sm.pick([1000, 5000, 16000, 31 * 60 * 1000]) };
    if (r < 0.2) return { ev: 'remount' };
    if (r < 0.25 && sub.kind === 'component' && sub.props) return { ev: 'props', props: sm.mut(encode(ctx.props), sub.props, 'props') };
    const all = targets();
    if (!all.length) return null;
    const fresh = all.filter((t) => !fired.has(coarseOf(t)));
    const t = fresh.length && sm.chance(0.7) ? sm.pick(fresh) : sm.pick(all);
    fired.add(coarseOf(t));
    return stepFor(sm, input, t, all.filter((x) => x.sig === t.sig).indexOf(t));
  };
}

function stripFns(v) {
  return JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x === 'object' && x.$fn && k === 'refetch' ? undefined : x)));
}

/**
 * The probe: search for scenarios that reach new code, within a time budget, and write the kept ones (with their hits)
 * to `outFile`. Each kept scenario is replayed once more on its own afterwards (the generated test runs it that way).
 */
async function fuzz(input, getSubject, outFile) {
  const fs = require('fs');
  const sm = sampler(input);
  // a search runs in rounds (one jest process each, so memory starts fresh); a later round resumes from this state
  const prev = input.resume || {};
  const seen = new Set(prev.seen || []);
  const corpus = prev.corpus || [];
  const fired = new Set(prev.fired || []);
  const known = new Set(prev.known || []);
  const frontier = prev.frontier || [];
  const reachedBefore = seen.size;
  input.inputValues = [...new Set([...(input.pools.numbers || []).slice(0, 40).map(String), '', '0', '50', '100', '150', '-5', 'abc', '12.5', ...(input.pools.strings || []).slice(0, 40)])];
  input.keyValues = [...new Set([...KEYS, ...((input.pools.byKey || {}).key || []).filter((k) => typeof k === 'string')])];
  // a target's kind, for breadth-first exploration: its event, tag and label, not its (data-dependent) text
  const onTargets = (sc, prefix) => {
    const all = targets();
    all.forEach((t, i) => {
      const key = coarseOf(t);
      if (known.has(key) || frontier.length >= 150) return;
      known.add(key);
      // the scenario's inputs are shared, not copied (every later use clones before changing them)
      frontier.push({ key, base: { ...sc, steps: prefix.slice() }, t: { ev: t.ev, sig: t.sig }, n: all.slice(0, i).filter((x) => x.sig === t.sig).length });
    });
  };
  const started = Date.now();
  const budget = input.budgetMs || 20000;
  const maxIdle = input.maxIdle || 400;
  let idle = 0;
  let runs = 0;
  const seeds = (input.seeds || []).slice();
  while (Date.now() - started < budget && idle < maxIdle) {
    let sc;
    let count = sm.pick([0, 1, 2, 3, 4, 6, 8]);
    if (seeds.length) sc = seeds.shift();
    else if (frontier.length && sm.chance(0.6)) {
      // breadth first: act on a target no scenario has acted on yet, from the state that showed it
      const f = frontier.shift();
      sc = { ...f.base, steps: f.base.steps.slice() };
      sc.steps.push(stepFor(sm, input, f.t, f.n));
      fired.add(f.key);
      count = sm.pick([0, 0, 1, 2]);
    } else if (corpus.length && sm.chance(0.65)) sc = mutateScenario(sm, input, sm.pick(corpus).sc);
    else sc = genScenario(sm, input);
    const explore = input.subject.kind === 'pure' ? null : { count, next: explorer(sm, input, fired), onTargets };
    beforeEachScenario(input.envRuntime);
    const before = snapCounters();
    let obs;
    try { obs = await runScenario(input.subject.kind, getSubject(), sc, explore); } catch (e) { obs = [{ error: errorText(e) }]; }
    afterEachScenario();
    runs++;
    const hits = hitsSince(before);
    const fresh = hits.filter((h) => !seen.has(h));
    if (fresh.length && !obs.some((o) => o.missing)) {
      for (const h of hits) seen.add(h);
      corpus.push({ sc, hits });
      idle = 0;
    } else idle++;
  }
  // greedy set cover: the fewest scenarios that keep every counter reached
  const left = new Set(seen);
  const chosen = [];
  const pool = corpus.slice();
  while (left.size && pool.length) {
    let best = -1; let bestN = 0;
    pool.forEach((c, i) => { const n = c.hits.filter((h) => left.has(h)).length; if (n > bestN) { bestN = n; best = i; } });
    if (best < 0) break;
    const c = pool.splice(best, 1)[0];
    for (const h of c.hits) left.delete(h);
    chosen.push(c.sc);
    if (chosen.length >= (input.maxTests || 60)) break;
  }
  const stoppedBy = idle >= maxIdle ? 'idle' : 'budget';
  fs.writeFileSync(`${outFile}.state.json`, JSON.stringify({ seen: [...seen], corpus, fired: [...fired], known: [...known], frontier, runs: (prev.runs || 0) + runs }));
  fs.writeFileSync(outFile, JSON.stringify({ subject: input.subject.id, runs: (prev.runs || 0) + runs, kept: corpus.length, reached: seen.size, gained: seen.size - reachedBefore, stoppedBy, explored: fired.size, frontierLeft: frontier.length, firedKeys: process.env.LINE_CHAR_DEBUG ? [...fired] : undefined, scenarios: chosen }));
}

/** Second probe run: the chosen scenarios in test order, each observed and its counters located in the source. */
async function record(input, getSubject, outFile) {
  const fs = require('fs');
  const results = [];
  for (const sc of input.scenarios) {
    beforeEachScenario(input.envRuntime);
    const before = snapCounters();
    let obs;
    try { obs = await runScenario(input.subject.kind, getSubject(), JSON.parse(JSON.stringify(sc))); } catch (e) { obs = [{ error: errorText(e) }]; }
    afterEachScenario();
    results.push({ obs, hits: hitsSince(before) });
  }
  fs.writeFileSync(outFile, JSON.stringify({ subject: input.subject.id, results, maps: remappedMaps(input.rootDir || process.cwd()) }));
}

module.exports = {
  encode, revive, hookModuleMock, nextNavigationMock,
  beforeEachScenario, afterEachScenario, runScenario, expectScenario,
  fuzz, record, sampler, genScenario, mutateScenario,
};
