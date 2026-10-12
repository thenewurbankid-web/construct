// Line logic verification, spec D (step 4): THE sandbox child of isolatedRun.mjs. It is started by runIsolated with
// node's permission model on (no fs writes, no child processes, no workers; reads limited to this file, recorder.cjs and
// the run's temp dir), code generation from strings off, an empty environment and a temp dir as cwd. It reads
// request.json from its cwd, runs every case of both sides in a fresh vm context whose only effectful globals are the
// recording fakes (fakes.mjs interfaces), and prints one JSON line: {before: Run[], after: Run[]}.
//
// Every effect the fakes do not back (a node builtin, an unknown package, process, WebSocket, XMLHttpRequest, window,
// document ...) throws NotFakedError at the access, BEFORE anything happens, and the run lists it under notFaked: the
// effect is reported, never executed. An app-local import that resolves to no file inside the app root is a recording
// spy (every export records `<export>.<method>`), so a unit is verified by what it calls, not by code the run lacks.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { shapeOf, urlPattern } = require('../graph/runtime/recorder.cjs');

const SENTINEL = /__line_([0-9a-f]{8})_(\d+)__/g;
const findSentinels = (text) => [...new Set([...String(text).matchAll(SENTINEL)].map((m) => `${m[1]}_${m[2]}`))];
const json = (v) => { try { return JSON.stringify(v) ?? ''; } catch { return ''; } };
const MAX_TIMERS = 1000;

class NotFakedError extends Error {
  constructor(what) { super(`${what} is not faked; the call was not executed.`); this.name = 'NotFakedError'; this.member = what; }
}

/** mulberry32, the characterizer's seeded random. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** One run's recording fakes (fakes.mjs RecordingFakes, without the DOM stub: DOM access is not faked here). */
function createFakes(env) {
  const effects = [];
  const transitions = [];
  const notFaked = new Set();
  let seq = 0;
  let timeSeen = false;
  // a key built from an input (a storage key, a URL path) keeps its shape: each sentinel becomes :sentinel (and is
  // listed in the record's sentinels), quotes are dropped, an empty key reads (empty)
  const rec = (effect, op, extra = {}, args = []) => {
    const key = extra.key === undefined ? {} : { key: String(extra.key).replace(SENTINEL, ':sentinel').replace(/["'`]/g, '') || '(empty)' };
    effects.push({ seq: seq++, effect, op, ...extra, ...key, args: args.map((a) => shapeOf(a)), sentinels: findSentinels(json(args) + String(extra.key ?? '')) });
  };
  const refuse = (what) => { notFaked.add(what); throw new NotFakedError(what); };
  // fake clock
  let now = Date.parse(env.now);
  let timerId = 0;
  const timers = new Map();
  const schedule = (op, cb, ms, args, repeat) => {
    rec('timer', `timer.${op}`, {}, [ms]);
    const id = ++timerId;
    timers.set(id, { at: now + (Number(ms) || 0), cb, args, repeat: repeat ? Math.max(1, Number(ms) || 0) : 0 });
    return id;
  };
  const clock = {
    now: () => { if (!timeSeen) { timeSeen = true; rec('time', 'Date.now'); } return now; },
    setTimeout: (cb, ms, ...args) => schedule('setTimeout', cb, ms, args, false),
    setInterval: (cb, ms, ...args) => schedule('setInterval', cb, ms, args, true),
    clearTimeout: (id) => { rec('timer', 'timer.clearTimeout'); timers.delete(id); },
    clearInterval: (id) => { rec('timer', 'timer.clearInterval'); timers.delete(id); },
    queueMicrotask: (cb) => { rec('timer', 'timer.queueMicrotask'); Promise.resolve().then(cb); },
    /** Fire due timers in time order; an endless interval stops at MAX_TIMERS and is reported. */
    runAll() {
      for (let fired = 0; timers.size; fired++) {
        if (fired >= MAX_TIMERS) { notFaked.add(`more than ${MAX_TIMERS} timers`); timers.clear(); return; }
        const [id, t] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        now = Math.max(now, t.at);
        if (t.repeat) t.at = now + t.repeat; else timers.delete(id);
        if (typeof t.cb === 'function') t.cb(...t.args);
      }
    },
  };
  const random = mulberry32(env.seed);
  const storage = (kind) => {
    const m = new Map();
    return {
      getItem: (k) => { rec('storage', 'storage.getItem', { key: String(k) }); return m.has(String(k)) ? m.get(String(k)) : null; },
      setItem: (k, v) => { rec('storage', 'storage.setItem', { key: String(k) }, [v]); m.set(String(k), String(v)); },
      removeItem: (k) => { rec('storage', 'storage.removeItem', { key: String(k) }); m.delete(String(k)); },
      clear: () => { rec('storage', 'storage.clear', { key: kind }); m.clear(); },
      key: (i) => [...m.keys()][i] ?? null,
      get length() { return m.size; },
    };
  };
  const respond = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => json(body) });
  const fetch = async (input, init = {}) => {
    const method = String(init.method ?? 'GET').toUpperCase();
    rec('fetch', 'fetch', { key: urlPattern(input), method }, init.body === undefined ? [] : [init.body]);
    return respond(404, null);
  };
  const axiosCall = (m) => async (url, ...rest) => {
    rec('fetch', `axios.${m}`, { key: urlPattern(url), method: m.toUpperCase() }, rest.slice(0, ['get', 'delete'].includes(m) ? 0 : 1));
    return { status: 200, data: null, headers: {} };
  };
  const axios = Object.assign(axiosCall('get'), { get: axiosCall('get'), post: axiosCall('post'), put: axiosCall('put'), patch: axiosCall('patch'), delete: axiosCall('delete') });
  axios.request = (cfg = {}) => axiosCall(String(cfg.method ?? 'get').toLowerCase())(cfg.url, cfg.data);
  axios.create = () => axios;
  const router = {
    pathname: '/', searchParams: new URLSearchParams(),
    push: (href) => rec('navigation', 'router.push', { key: urlPattern(href) }),
    replace: (href) => rec('navigation', 'router.replace', { key: urlPattern(href) }),
    back: () => rec('navigation', 'router.back'),
    forward: () => rec('navigation', 'router.forward'),
    refresh: () => rec('navigation', 'router.refresh'),
    prefetch: (href) => rec('navigation', 'router.prefetch', { key: urlPattern(href) }),
    navigate: (to) => rec('navigation', 'router.navigate', typeof to === 'string' ? { key: urlPattern(to) } : {}, typeof to === 'string' ? [] : [to]),
  };
  const store = {
    dispatch: (action) => {
      const type = action && typeof action === 'object' && typeof action.type === 'string' ? action.type : 'thunk';
      rec('store', 'store.dispatch', { key: type }, action && typeof action === 'object' && 'payload' in action ? [action.payload] : []);
      transitions.push({ seq: transitions.length, key: 'store', action: type });
      return action;
    },
    getState: () => ({}),
    subscribe: () => () => {},
  };
  const toastFn = (m) => (...args) => rec('toast', `toast.${m}`, {}, args);
  const toast = Object.assign(toastFn('show'), { success: toastFn('success'), error: toastFn('error'), info: toastFn('info'), warning: toastFn('warning'), show: toastFn('show'), dismiss: toastFn('dismiss') });
  const analyticsFn = (m) => (name, ...args) => rec('analytics', `analytics.${m}`, typeof name === 'string' ? { key: name } : {}, args);
  const analytics = { track: analyticsFn('track'), page: analyticsFn('page'), identify: analyticsFn('identify') };
  const consoleFake = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map((m) => [m, (...args) => rec('console', `console.${m}`, {}, args)]));
  // the modules the fakes back; anything else is refused at require time
  const MODULES = {
    'next/navigation': { useRouter: () => router, usePathname: () => router.pathname, useSearchParams: () => router.searchParams, redirect: (h) => router.replace(h) },
    'next/router': { useRouter: () => router, default: router },
    'react-router': { useNavigate: () => router.navigate },
    'react-router-dom': { useNavigate: () => router.navigate },
    axios: Object.assign(axios, { default: axios, __esModule: true }),
    'react-redux': { useDispatch: () => store.dispatch, useSelector: (f) => f(store.getState()) },
    'react-hot-toast': { __esModule: true, default: toast, toast },
    sonner: { toast },
    'react-toastify': { toast },
  };
  /**
   * An app-local module the run does not have (the unit's relative import that resolves to no file): every export is a
   * recording spy, op `<export>.<method>` (the characterizer's label for spied objects), its effect named from the
   * module's path (api -> fetch, toast -> toast ...; else mutation). A call resolves to undefined.
   */
  const spyModule = (spec) => {
    const base = spec.split('/').pop().toLowerCase();
    const effect = (SPY_EFFECTS.find(([re]) => re.test(base)) ?? [null, 'mutation'])[1];
    const spy = (label) => new Proxy(function spied() {}, {
      get: (_t, prop) => (typeof prop === 'symbol' || prop === 'then' ? undefined : spy(`${label}.${String(prop)}`)),
      apply: (_t, _this, args) => { rec(effect, label, {}, args); return effect === 'fetch' ? Promise.resolve(undefined) : undefined; },
    });
    return new Proxy({ __esModule: true }, { get: (t, prop) => (prop in t || typeof prop === 'symbol' ? t[prop] : spy(String(prop))) });
  };
  return { rec, effects, transitions, notFaked, refuse, clock, random, storage, fetch, MODULES, analytics, consoleFake, spyModule };
}

const SPY_EFFECTS = [[/api|http|client|fetch|request/, 'fetch'], [/toast|notif|snack/, 'toast'], [/analytic|track|telemetry/, 'analytics'], [/router|navigat|history/, 'navigation'], [/store|dispatch|slice|redux/, 'store'], [/storage|cache/, 'storage']];
/** A hook that keeps setting state on every render stops here and throws TooManyRendersError (on both sides alike). */
const MAX_RENDERS = 25;

class TooManyRendersError extends Error { constructor() { super(`more than ${MAX_RENDERS} renders`); this.name = 'TooManyRendersError'; } }

const depsChanged = (prev, next) => !prev || !next || prev.length !== next.length || next.some((d, i) => !Object.is(d, prev[i]));

/**
 * The headless hook runner (spec D: "hooks run in a headless hook runner, a no-op React renderer"): a render-free
 * harness behind the `react` module. Hook slots are kept by call order as React does; a state setter or reducer
 * dispatch records a state transition (`state.<slot>` / `reducer.<slot>`, action names only) and schedules a re-render;
 * effects run after each render when their deps change, and their cleanups run before the next run and at unmount.
 */
function createHookHarness(f) {
  const slots = [];
  let i = 0;
  let dirty = false;
  let pending = [];
  const transition = (key, action) => f.transitions.push({ seq: f.transitions.length, key, ...(action ? { action } : {}) });
  const slot = (init) => { const k = i++; if (!(k in slots)) slots[k] = init(); return [k, slots[k]]; };
  const effect = (fn, deps) => {
    const [, s] = slot(() => ({ deps: undefined, cleanup: undefined, fn: undefined, fresh: true }));
    if (s.fresh || depsChanged(s.deps, deps)) { s.fresh = false; s.deps = deps; s.fn = fn; pending.push(s); }
  };
  const useReducer = (reducer, initArg, initFn) => {
    const [k, s] = slot(() => {
      const st = { value: initFn ? initFn(initArg) : initArg };
      st.dispatch = (action) => {
        transition(`reducer.${k}`, action && typeof action === 'object' && typeof action.type === 'string' && /^[\w./:-]+$/.test(action.type) ? action.type : 'dispatch');
        const next = reducer(st.value, action);
        if (!Object.is(next, st.value)) { st.value = next; dirty = true; }
      };
      return st;
    });
    return [s.value, s.dispatch];
  };
  const useState = (init) => {
    const [k, s] = slot(() => {
      const st = { value: typeof init === 'function' ? init() : init };
      st.set = (v) => {
        transition(`state.${k}`, 'set');
        const next = typeof v === 'function' ? v(st.value) : v;
        if (!Object.is(next, st.value)) { st.value = next; dirty = true; }
      };
      return st;
    });
    return [s.value, s.set];
  };
  const memo = (fn, deps) => { const [, s] = slot(() => ({ deps: undefined, value: undefined, fresh: true })); if (s.fresh || depsChanged(s.deps, deps)) { s.fresh = false; s.deps = deps; s.value = fn(); } return s.value; };
  const react = {
    __esModule: true,
    useState, useReducer,
    useEffect: effect, useLayoutEffect: effect, useInsertionEffect: effect,
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useRef: (init) => slot(() => ({ current: init }))[1],
    useContext: (ctx) => (ctx && typeof ctx === 'object' ? ctx._currentValue : undefined),
    createContext: (value) => ({ _currentValue: value, Provider: 'Provider', Consumer: 'Consumer' }),
    useId: () => `line-id-${slot(() => 0)[0]}`,
    useTransition: () => [false, (cb) => cb()],
    useDeferredValue: (v) => v,
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useImperativeHandle: () => {},
    useDebugValue: () => {},
    memo: (c) => c, forwardRef: (c) => c, Fragment: 'Fragment',
    createElement: (type, props, ...children) => ({ $$typeof: 'element', type: typeof type === 'string' ? type : 'component', props: { ...props, children } }),
  };
  react.default = react;
  const flush = () => {
    const run = pending;
    pending = [];
    for (const s of run) {
      if (typeof s.cleanup === 'function') s.cleanup();
      s.cleanup = s.fn();
    }
  };
  return {
    module: react,
    /** Render until no state changes (each render runs the effects whose deps changed); returns the last result. */
    render(unit, args) {
      let out;
      let renders = 0;
      do {
        if (++renders > MAX_RENDERS) throw new TooManyRendersError();
        dirty = false;
        i = 0;
        pending = [];
        out = unit(...args);
        flush();
      } while (dirty);
      return out;
    },
    unmount() { for (const s of slots) if (s && typeof s.cleanup === 'function') { const c = s.cleanup; s.cleanup = undefined; c(); } },
  };
}

/**
 * The synthetic event a handler unit gets (spec D: "handlers get fake events"): a React-style event of the type its
 * annotation names, with a target whose value, checked state and key vary per case; preventDefault and stopPropagation
 * record a dom effect.
 */
function syntheticEvent(f, desc, env) {
  const v = Number(desc.variant) || 0;
  const value = [`__line_${(env.seed >>> 0).toString(16).padStart(8, '0')}_${300 + v}__`, '', '0', 'a b'][v % 4];
  const target = { value, checked: v % 2 === 0, name: 'field', id: 'field', type: 'text', dataset: {}, files: [] };
  const ev = {
    type: String(desc.__lineEvent), target, currentTarget: target, key: ['Enter', 'Escape', 'a', 'Tab'][v % 4], code: '', button: 0,
    clientX: 0, clientY: 0, deltaY: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, nativeEvent: {},
    preventDefault() { f.rec('dom', 'event.preventDefault'); ev.defaultPrevented = true; },
    stopPropagation() { f.rec('dom', 'event.stopPropagation'); },
    persist() {},
  };
  return ev;
}

/**
 * V8 block coverage of the unit for one run: every range V8 reports inside the unit's source text, as
 * [start, end, count] with offsets from the unit's start (so runs of the same side line up). V8 leaves out a block
 * whose count equals its parent's, so isolatedRun.mjs reads a block missing from a run at its innermost reported holder.
 * @returns {Array<[number, number, number]>}
 */
function unitRanges(scripts, url, from, to) {
  return scripts.filter((s) => s.url === url).flatMap((s) => s.functions.flatMap((fn) => fn.ranges))
    .filter((r) => r.startOffset >= from && r.endOffset <= to).map((r) => [r.startOffset - from, r.endOffset - from, r.count]);
}

/** The in-process inspector session for coverage, or null when the permission model does not allow it. */
function coverageSession() {
  try {
    const inspector = require('node:inspector');
    const s = new inspector.Session();
    s.connect();
    const post = (m, p) => new Promise((res, rej) => s.post(m, p, (e, r) => (e ? rej(e) : res(r))));
    return { post };
  } catch {
    return null;
  }
}

let runId = 0;

/** Run the unit once under fresh fakes. */
async function runOnce(side, args, env, cov) {
  const f = createFakes(env);
  const harness = createHookHarness(f);
  f.MODULES.react = harness.module;
  const url = `${side.entry}#${++runId}`;
  let unitSpan = null;
  if (cov) await cov.post('Profiler.takePreciseCoverage');
  const sandbox = {};
  const unfaked = ['process', 'require', 'module', 'Buffer', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'indexedDB', 'navigator', 'window', 'document', 'location', 'history', 'Worker', 'setImmediate', 'importScripts'];
  for (const name of unfaked) Object.defineProperty(sandbox, name, { get: () => f.refuse(name), configurable: false });
  Object.assign(sandbox, {
    fetch: f.fetch, localStorage: f.storage('local'), sessionStorage: f.storage('session'), console: f.consoleFake, analytics: f.analytics,
    setTimeout: f.clock.setTimeout, setInterval: f.clock.setInterval, clearTimeout: f.clock.clearTimeout, clearInterval: f.clock.clearInterval,
    queueMicrotask: f.clock.queueMicrotask, URL, URLSearchParams, TextEncoder, TextDecoder,
    __line: { now: f.clock.now, random: f.random },
  });
  const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  // fixed time and seeded random, made inside the context so instanceof Date holds for the unit
  vm.runInContext(`(() => { const L = __line; const D = Date;
    class FakeDate extends D { constructor(...a) { if (a.length) super(...a); else super(L.now()); } static now() { return L.now(); } }
    globalThis.Date = FakeDate; Math.random = L.random; delete globalThis.__line; })();`, ctx);
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const code = side.modules[file];
    const mod = { exports: {} };
    cache.set(file, mod);
    const req = (spec) => {
      if (spec.startsWith('.')) {
        const target = side.resolved[file]?.[spec];
        if (target) return load(target);
        return side.missing[file]?.includes(spec) ? f.spyModule(spec) : f.refuse(`import ${spec}`);
      }
      if (Object.prototype.hasOwnProperty.call(f.MODULES, spec)) return f.MODULES[spec];
      return f.refuse(`import ${spec}`);
    };
    const wrapped = `(function (exports, require, module) {${code}\n})`;
    vm.runInContext(wrapped, ctx, { filename: file === side.entry ? url : file })(mod.exports, req, mod);
    if (file === side.entry && typeof mod.exports.__lineUnit === 'function') {
      const at = wrapped.indexOf(Function.prototype.toString.call(mod.exports.__lineUnit));
      unitSpan = at < 0 ? [0, wrapped.length] : [at, at + Function.prototype.toString.call(mod.exports.__lineUnit).length];
    }
    return mod.exports;
  };
  // a handler's generated event is made here, inside the run, so its preventDefault records into this run's fakes
  const callArgs = args.map((a) => (a && typeof a === 'object' && typeof a.__lineEvent === 'string' ? syntheticEvent(f, a, env) : a));
  const settle = async () => { f.clock.runAll(); await new Promise((r) => setImmediate(r)); f.clock.runAll(); };
  let output;
  let thrown = null;
  try {
    const unit = load(side.entry).__lineUnit;
    if (typeof unit !== 'function') throw new TypeError(`${side.fn} is not a function`);
    if (side.runAs === 'hook') {
      // render and settle, then call each function the hook returns (its handlers) with the case's arguments, settle
      // and re-render after each, then unmount: what the hook returns last is the output
      output = harness.render(unit, callArgs);
      await settle();
      output = harness.render(unit, callArgs);
      const calls = typeof output === 'function' ? [[]] : output && typeof output === 'object' ? Object.keys(output).sort().filter((k) => typeof output[k] === 'function').map((k) => [k]) : [];
      for (const [k] of calls) {
        const fn = k === undefined ? output : output[k];
        const r = fn(...callArgs);
        if (r && typeof r.then === 'function') await r;
        await settle();
        output = harness.render(unit, callArgs);
      }
      harness.unmount();
      await settle();
    } else {
      output = unit(...callArgs);
      if (output && typeof output.then === 'function') output = await output;
      await settle();
    }
  } catch (e) {
    thrown = e && typeof e.name === 'string' && /^[A-Z]\w*$/.test(e.name) ? e.name : 'Error';
  }
  let ranges = null;
  if (cov && unitSpan) ranges = unitRanges((await cov.post('Profiler.takePreciseCoverage')).result, url, unitSpan[0], unitSpan[1]);
  // a hook's object result is compared by value too, with each function as fn
  const plain = (o) => { try { return JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === 'function' ? 'fn' : v))); } catch { return undefined; } };
  const value = output === null || ['boolean', 'number', 'string'].includes(typeof output) ? output : side.runAs === 'hook' && !thrown ? plain(output) : undefined;
  const inner = ranges ? ranges.filter(([a, b]) => !(a === 0 && b === unitSpan[1] - unitSpan[0])) : null;
  const branches = inner ? { covered: inner.filter((r) => r[2] > 0).length, total: inner.length } : undefined;
  return {
    run: {
      inputs: callArgs.map((a, k) => (a !== args[k] ? 'event' : shapeOf(a))), output: thrown ? 'undefined' : shapeOf(output), thrown, effects: f.effects, transitions: f.transitions,
      sentinels: findSentinels(json(output) + f.effects.flatMap((e) => e.sentinels).map((s) => `__line_${s}__`).join(' ')), ...(branches ? { branches } : {}),
    },
    value: typeof value === 'number' && !Number.isFinite(value) ? String(value) : value,
    notFaked: [...f.notFaked].sort(),
    ranges,
    span: unitSpan ? unitSpan[1] - unitSpan[0] : null,
  };
}

async function main() {
  const req = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'request.json'), 'utf8'));
  const cov = req.coverage ? coverageSession() : null;
  if (cov) {
    await cov.post('Profiler.enable');
    await cov.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  }
  const out = { before: [], after: [], coverage: Boolean(cov) };
  for (const args of req.cases) {
    out.before.push(await runOnce(req.before, args, req.env, cov));
    out.after.push(await runOnce(req.after, args, req.env, cov));
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

main().catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exitCode = 1; });
