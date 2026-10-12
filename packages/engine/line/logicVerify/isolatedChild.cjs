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
  return { effects, transitions, notFaked, refuse, clock, random, storage, fetch, MODULES, analytics, consoleFake, spyModule };
}

const SPY_EFFECTS = [[/api|http|client|fetch|request/, 'fetch'], [/toast|notif|snack/, 'toast'], [/analytic|track|telemetry/, 'analytics'], [/router|navigat|history/, 'navigation'], [/store|dispatch|slice|redux/, 'store'], [/storage|cache/, 'storage']];

/** Run the unit once under fresh fakes. */
async function runOnce(side, args, env) {
  const f = createFakes(env);
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
    vm.runInContext(`(function (exports, require, module) {${code}\n})`, ctx, { filename: file })(mod.exports, req, mod);
    return mod.exports;
  };
  let output;
  let thrown = null;
  try {
    const unit = load(side.entry).__lineUnit;
    if (typeof unit !== 'function') throw new TypeError(`${side.fn} is not a function`);
    output = unit(...args);
    if (output && typeof output.then === 'function') output = await output;
    f.clock.runAll();
    await new Promise((r) => setImmediate(r));
    f.clock.runAll();
  } catch (e) {
    thrown = e && typeof e.name === 'string' && /^[A-Z]\w*$/.test(e.name) ? e.name : 'Error';
  }
  const value = output === null || ['boolean', 'number', 'string'].includes(typeof output) ? output : undefined;
  return {
    run: { inputs: args.map((a) => shapeOf(a)), output: thrown ? 'undefined' : shapeOf(output), thrown, effects: f.effects, transitions: f.transitions, sentinels: findSentinels(json(output) + f.effects.flatMap((e) => e.sentinels).map((s) => `__line_${s}__`).join(' ')) },
    value: typeof value === 'number' && !Number.isFinite(value) ? String(value) : value,
    notFaked: [...f.notFaked].sort(),
  };
}

async function main() {
  const req = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'request.json'), 'utf8'));
  const out = { before: [], after: [] };
  for (const args of req.cases) {
    out.before.push(await runOnce(req.before, args, req.env));
    out.after.push(await runOnce(req.after, args, req.env));
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

main().catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exitCode = 1; });
