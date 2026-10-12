// G2 runtime recorder core (CommonJS so it loads both inside jest's module sandbox and in plain node).
// It wraps functions so that each call records caller -> callee by MODULE IDENTITY ({file, name}: the app-relative file
// and the export name), with argument and return SHAPES (type tags and keys, never values); fetch calls by method and
// URL pattern; and state writes (React setState, useReducer / redux dispatch) by key only. The caller is the innermost
// wrapped function on the current async context (AsyncLocalStorage), so a call after an `await` keeps its caller.
// No code text and no values are ever stored. Contract: ./contract.mjs (RuntimeRecord, RuntimeRef).
'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

const MAX_DEPTH = 4;
const MAX_KEYS = 24;
const WRAPPED = Symbol.for('line.runtime.wrapped');
const DATA_KEY = /^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|.*\d.*\d.*)$/i;

/** A value's shape: type tags and keys only. */
function shapeOf(v, depth = 0) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'function') return 'fn';
  if (t !== 'object') return t;
  if (typeof v.then === 'function') return 'promise';
  if (v instanceof Date) return 'date';
  if (v instanceof Error) return 'error';
  if (v instanceof Map) return 'map';
  if (v instanceof Set) return 'set';
  if (v.$$typeof) return 'element';
  if (typeof v.type === 'string' && v.nativeEvent && typeof v.preventDefault === 'function') return 'event';
  if (typeof v.nodeType === 'number' && typeof v.nodeName === 'string') return 'node';
  if (depth >= MAX_DEPTH) return Array.isArray(v) ? 'array' : 'object';
  if (Array.isArray(v)) {
    if (!v.length) return 'never[]';
    const parts = [...new Set(v.slice(0, 3).map((x) => shapeOf(x, depth + 1)))];
    return parts.length === 1 ? `${parts[0]}[]` : `(${parts.join('|')})[]`;
  }
  let keys;
  try { keys = Object.keys(v); } catch { return 'object'; }
  // keys that look like data (ids, numbers) or too many keys: a record, so no id leaks as a key
  if (keys.length > MAX_KEYS || (keys.length && keys.every((k) => DATA_KEY.test(k)))) {
    const vals = [...new Set(keys.slice(0, 3).map((k) => shapeOf(v[k], depth + 1)))];
    return `{[key]:${vals.join('|')}}`;
  }
  return `{${keys.sort().map((k) => `${k}:${shapeOf(v[k], depth + 1)}`).join(',')}}`;
}

const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)$/i;
/** A URL with its ids replaced by `:id` and its query values dropped (keys kept). */
function urlPattern(input) {
  let url = typeof input === 'string' ? input : input && typeof input === 'object' ? String(input.url ?? input.href ?? '') : String(input);
  const hashAt = url.indexOf('#');
  if (hashAt >= 0) url = url.slice(0, hashAt);
  const q = url.indexOf('?');
  const base = q >= 0 ? url.slice(0, q) : url;
  const query = q >= 0 ? url.slice(q + 1) : '';
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)?(.*)$/i.exec(base);
  const origin = m?.[1] ?? '';
  const pathPart = (m?.[2] ?? '').split('/').map((s) => (s && ID_SEGMENT.test(s) ? ':id' : s)).join('/');
  const keys = query ? query.split('&').filter(Boolean).map((kv) => `${decodeURIComponent(kv.split('=')[0])}=`) : [];
  return `${origin}${pathPart}${keys.length ? `?${keys.join('&')}` : ''}`;
}

/** A short hash of a handler's normalized text (the text itself is never stored). */
function handlerHash(text) {
  return crypto.createHash('sha256').update(normalizeHandlerText(text)).digest('hex').slice(0, 12);
}
/** Handler text normalized so compiled output (ts-jest, babel) and the logic map's source detail compare equal. */
function normalizeHandlerText(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '') // comments (istanbul ignore hints)
    .replace(/\bcov_[\w$]+\(\)\.[fsb]\[\d+\](?:\[\d+\])?\+\+\s*[;,]?/g, '') // istanbul counters (jest --coverage)
    .replace(/\(0,\s*[\w$]+\.([\w$]+)\)/g, '$1') // (0, mod_1.fn)(...) -> fn(...)
    .replace(/\b[\w$]+_\d+\.([\w$]+)/g, '$1') // mod_1.fn -> fn
    .replace(/\bvoid 0\b/g, 'undefined')
    .replace(/[\s;]+/g, '')
    .replace(/=>\{return(.*)\}$/, '=>$1') // an expression body istanbul turned into a block
    .replace(/[()]/g, '') // the parentheses istanbul adds around branch counters
    .replace(/["'`]/g, "'")
    .slice(0, 40);
}

/**
 * One recorder: its records, its async context and the wrappers. `test()` names the running test (evidence).
 * @param {{test?: () => string|undefined, isMock?: (fn: Function) => boolean}} [o]
 */
function createRecorder(o = {}) {
  const als = new AsyncLocalStorage();
  const agg = new Map();
  const loaded = new Set();
  const handlerCache = new WeakMap();
  const testName = o.test ?? (() => undefined);
  const isMock = o.isMock ?? ((fn) => typeof fn?.mock === 'object' && typeof fn?.mockReturnValue === 'function');

  const current = () => als.getStore() ?? null;
  const add = (rec) => {
    const t = testName() ?? null;
    const full = { ...rec, test: t };
    const key = JSON.stringify(full);
    const had = agg.get(key);
    if (had) had.count++;
    else agg.set(key, { ...full, count: 1 });
  };
  const safeShapes = (args) => { try { return Array.prototype.map.call(args, (a) => shapeOf(a)); } catch { return ['?']; } };
  const safeShape = (v) => { try { return shapeOf(v); } catch { return '?'; } };

  /**
   * Wrap `fn` as `ref`. Components (`render: true`) do not take a caller on invocation (React calls them; the render
   * edge is recorded where their element is created), everything else records the current frame as its caller.
   */
  function wrap(fn, ref, opts = {}) {
    if (typeof fn !== 'function' || fn[WRAPPED]) return fn;
    const mocked = isMock(fn);
    const isComponent = opts.component ?? /^[A-Z]/.test(ref.local ?? ref.name ?? '');
    const frameRef = ref;
    const wrapped = function lineRuntimeWrapped(...args) {
      const caller = current();
      const frame = { ref: frameRef, states: 0 };
      const rec = { kind: 'call', from: isComponent ? null : caller?.ref ?? null, to: frameRef, args: safeShapes(args) };
      if (mocked) rec.mocked = true;
      if (opts.via) rec.via = opts.via;
      let ret;
      try {
        ret = als.run(frame, () => (new.target ? Reflect.construct(fn, args, new.target) : fn.apply(this, args)));
      } catch (err) {
        add({ ...rec, ret: 'throws' });
        throw err;
      }
      add({ ...rec, ret: safeShape(ret) });
      return ret;
    };
    try { Object.defineProperty(wrapped, 'name', { value: fn.name }); } catch { /* not renameable */ }
    try { Object.defineProperty(wrapped, 'length', { value: fn.length }); } catch { /* fine */ }
    Object.setPrototypeOf(wrapped, Object.getPrototypeOf(fn));
    for (const k of Object.keys(fn)) { try { wrapped[k] = fn[k]; } catch { /* read-only */ } }
    if (fn.prototype) wrapped.prototype = fn.prototype;
    wrapped[WRAPPED] = frameRef;
    return wrapped;
  }

  /**
   * Instrument a module's exports in place (or a copy when frozen): functions are wrapped as {file, name}, methods of
   * exported plain objects as {file, name: 'obj.method'}. Returns the (possibly new) exports object.
   */
  function instrumentExports(exports, meta) {
    if (!exports || (typeof exports !== 'object' && typeof exports !== 'function')) return exports;
    loaded.add(meta.file);
    const one = (name, v) => {
      if (typeof v === 'function') return wrap(v, { kind: 'export', file: meta.file, name, local: v.name || name });
      if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && !Object.isFrozen(v)) {
        for (const k of Object.keys(v)) if (typeof v[k] === 'function' && !v[k][WRAPPED]) {
          try { v[k] = wrap(v[k], { kind: 'export', file: meta.file, name: `${name}.${k}`, local: name }, { component: false }); } catch { /* read-only */ }
        }
      }
      return v;
    };
    if (typeof exports === 'function') return one('default', exports);
    for (const name of Object.keys(exports)) {
      const d = Object.getOwnPropertyDescriptor(exports, name);
      if (!d || !('value' in d)) continue; // a getter (re-export): the source module is instrumented itself
      const w = one(name, d.value);
      if (w !== d.value) {
        if (d.writable) exports[name] = w;
        else if (d.configurable) Object.defineProperty(exports, name, { ...d, value: w });
      }
    }
    return exports;
  }

  /**
   * A read-through view of a target module's exports for one importer: functions come back wrapped (cached per
   * function), everything else as is. The module object itself is not changed, so a jest.mock factory's functions stay
   * the test's own (mockReturnValue etc. keep working) and a later jest.spyOn is seen.
   */
  const views = new WeakMap();
  function exportsView(mod, file) {
    if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) return mod;
    if (views.has(mod)) return views.get(mod);
    const cache = new WeakMap();
    const view = new Proxy(mod, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (typeof prop !== 'string' || typeof v !== 'function' || v[WRAPPED]) return v;
        const d = Object.getOwnPropertyDescriptor(target, prop);
        if (d && 'value' in d && !d.writable && !d.configurable) return v; // proxy invariant
        if (!cache.has(v)) cache.set(v, wrap(v, { kind: 'export', file, name: prop, local: prop === 'default' ? v.name || prop : prop }));
        return cache.get(v);
      },
    });
    views.set(mod, view);
    return view;
  }

  /** A JSX on* handler of the component currently rendering, as {kind:'handler', file, owner, prop, hash}. */
  function wrapHandler(fn, prop, file) {
    if (typeof fn !== 'function' || fn[WRAPPED]) return fn;
    const owner = current();
    if (!owner) return fn;
    const byProp = handlerCache.get(fn);
    if (byProp?.has(prop)) return byProp.get(prop);
    const ref = { kind: 'handler', file: owner.ref.file ?? file, owner: owner.ref.local ?? owner.ref.name, prop, hash: handlerHash(Function.prototype.toString.call(fn)) };
    const ownerRef = owner.ref;
    const h = function lineRuntimeHandler(...args) {
      const frame = { ref, states: 0 };
      add({ kind: 'call', from: ownerRef, to: ref, via: 'handler', args: safeShapes(args), ret: 'event' });
      return als.run(frame, () => fn.apply(this, args));
    };
    h[WRAPPED] = ref;
    const m = byProp ?? new Map();
    m.set(prop, h);
    if (!byProp) handlerCache.set(fn, m);
    return h;
  }

  /** jsx / jsxs / createElement: record the render edge owner -> component, wrap on* handlers. */
  function wrapJsxFactory(factory, file) {
    if (typeof factory !== 'function' || factory[WRAPPED]) return factory;
    const f = function lineRuntimeJsx(type, props, ...rest) {
      const owner = current();
      if (owner && typeof type === 'function' && type[WRAPPED]) add({ kind: 'call', from: owner.ref, to: type[WRAPPED], via: 'render', args: [safeShape(props)], ret: 'element' });
      if (owner && props && typeof props === 'object') {
        let copy = null;
        for (const k of Object.keys(props)) {
          if (/^on[A-Z]/.test(k) && typeof props[k] === 'function') {
            copy ??= { ...props };
            copy[k] = wrapHandler(props[k], k, file);
          }
        }
        if (copy) props = copy;
      }
      return factory.call(this, type, props, ...rest);
    };
    f[WRAPPED] = { kind: 'jsx' };
    return f;
  }

  /** The state names a component declares, in order (from the transform's static scan), for setState keys. */
  function stateKey(frame, names) {
    const owner = frame?.ref.local ?? frame?.ref.name;
    const list = (owner && names?.[owner]) || [];
    const n = frame ? frame.states++ : 0;
    return { owner, key: list[n] ?? `state${n}` };
  }

  /** `react` with useState / useReducer wrapped (setter identity kept), and the jsx factories. */
  function wrapReact(react, meta) {
    if (!react || react[WRAPPED]) return react;
    const setters = new WeakMap();
    const keyed = (setter, file, owner, key, kind) => {
      let byKey = setters.get(setter);
      if (!byKey) { byKey = new Map(); setters.set(setter, byKey); }
      const k = `${owner}|${key}`;
      if (!byKey.has(k)) {
        byKey.set(k, function lineRuntimeSetState(...args) {
          const from = current()?.ref ?? null;
          const action = args[0];
          const actionKey = kind === 'dispatch' && action && typeof action === 'object' && typeof action.type === 'string' ? action.type : undefined;
          add({ kind: 'state', from, file, owner, key, ...(actionKey ? { action: actionKey } : {}) });
          return setter.apply(this, args);
        });
      }
      return byKey.get(k);
    };
    const out = Object.assign({}, react);
    if (typeof react.useState === 'function') out.useState = function useState(...a) {
      const r = react.useState(...a);
      const { owner, key } = stateKey(current(), meta.states);
      return [r[0], keyed(r[1], meta.file, owner, key, 'state')];
    };
    if (typeof react.useReducer === 'function') out.useReducer = function useReducer(...a) {
      const r = react.useReducer(...a);
      const { owner, key } = stateKey(current(), meta.states);
      return [r[0], keyed(r[1], meta.file, owner, key, 'dispatch')];
    };
    for (const k of ['createElement', 'jsx', 'jsxs', 'jsxDEV']) if (typeof react[k] === 'function') out[k] = wrapJsxFactory(react[k], meta.file);
    out.default = out;
    out[WRAPPED] = { kind: 'module' };
    return out;
  }

  /** react-redux's useDispatch: a dispatch that records the action type as the key. */
  function wrapRedux(mod) {
    if (!mod || mod[WRAPPED] || typeof mod.useDispatch !== 'function') return mod;
    const out = Object.assign({}, mod);
    const cache = new WeakMap();
    out.useDispatch = function useDispatch(...a) {
      const d = mod.useDispatch(...a);
      if (typeof d !== 'function') return d;
      if (!cache.has(d)) cache.set(d, function lineRuntimeDispatch(action, ...rest) {
        add({ kind: 'dispatch', from: current()?.ref ?? null, key: action && typeof action === 'object' && typeof action.type === 'string' ? action.type : typeof action });
        return d.call(this, action, ...rest);
      });
      return cache.get(d);
    };
    out.default = out;
    out[WRAPPED] = { kind: 'module' };
    return out;
  }

  /** axios: get/post/put/patch/delete/head/request record method + URL pattern. */
  function wrapAxios(mod) {
    if (!mod || mod[WRAPPED]) return mod;
    const one = (inst) => {
      if (!inst || (typeof inst !== 'object' && typeof inst !== 'function')) return inst;
      const out = typeof inst === 'function' ? function axiosCall(cfg, ...r) { record(typeof cfg === 'string' ? (r[0]?.method ?? 'GET') : cfg?.method ?? 'GET', typeof cfg === 'string' ? cfg : cfg?.url ?? ''); return inst.call(this, cfg, ...r); } : {};
      for (const k of Object.keys(inst)) out[k] = inst[k];
      for (const m of ['get', 'delete', 'head', 'options', 'post', 'put', 'patch']) {
        if (typeof inst[m] === 'function') out[m] = function axiosMethod(url, ...r) { record(m, url); return inst[m].call(inst, url, ...r); };
      }
      if (typeof inst.request === 'function') out.request = function axiosRequest(cfg) { record(cfg?.method ?? 'GET', cfg?.url ?? ''); return inst.request.call(inst, cfg); };
      return out;
    };
    const out = one(mod);
    if (mod.default && mod.default !== mod) out.default = one(mod.default);
    out[WRAPPED] = { kind: 'module' };
    return out;
  }

  function record(method, url) {
    add({ kind: 'fetch', from: current()?.ref ?? null, method: String(method || 'GET').toUpperCase(), url: urlPattern(url) });
  }

  /**
   * Install a recording `fetch` on `g` that survives tests replacing it (assignments land behind the recorder, a spy
   * that calls through to "the original" does not loop).
   */
  function installFetch(g) {
    const original = g.fetch;
    let inner = original;
    let busy = false;
    const recordingFetch = function fetch(input, init) {
      if (busy) return typeof original === 'function' ? original.call(this, input, init) : undefined;
      record(init?.method ?? (input && typeof input === 'object' ? input.method : undefined) ?? 'GET', input);
      busy = true;
      try { return inner.call(this, input, init); } finally { busy = false; }
    };
    recordingFetch[WRAPPED] = { kind: 'fetch' };
    try {
      Object.defineProperty(g, 'fetch', {
        configurable: true, enumerable: true,
        get: () => recordingFetch,
        set: (v) => { inner = v === recordingFetch ? original : v; },
      });
    } catch { /* not configurable: fetch is not recorded */ }
  }

  /** `require` for an instrumented module: react, react-redux and axios come back wrapped; app files resolved to a target get their exports wrapped (also when jest mocked them). */
  function wrapRequire(req, meta, isTarget) {
    const wrapped = function require(spec) {
      const mod = req(spec);
      if (spec === 'react' || spec === 'react/jsx-runtime' || spec === 'react/jsx-dev-runtime') return wrapReact(mod, meta);
      if (spec === 'react-redux') return wrapRedux(mod);
      if (spec === 'axios') return wrapAxios(mod);
      if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('/') || spec.startsWith('~/')) {
        let resolved = null;
        try { resolved = req.resolve(spec); } catch { resolved = null; }
        const file = resolved && isTarget(resolved);
        if (file) return exportsView(mod, file);
      }
      return mod;
    };
    for (const k of Object.keys(req)) wrapped[k] = req[k];
    return wrapped;
  }

  /** The records so far: one per distinct (kind, from, to, shapes, test), with a count. */
  function records() {
    return [...agg.values(), ...[...loaded].map((file) => ({ kind: 'load', file, test: null, count: 1 }))];
  }

  return { wrap, wrapHandler, wrapJsxFactory, wrapReact, wrapRedux, wrapAxios, wrapRequire, instrumentExports, installFetch, records, current };
}

module.exports = { createRecorder, shapeOf, urlPattern, handlerHash, normalizeHandlerText, WRAPPED };
