// QuickJS backend (#spike, sandbox: 'quickjs'): the guest program a QuickJS context runs. The recording fakes, the
// hook harness, the synthetic events and the coverage reader are NOT rewritten here: their top-level declarations are
// sliced out of isolatedChild.cjs (and shapeOf / urlPattern out of graph/runtime/recorder.cjs) by the TypeScript
// parser, so the vm child and the QuickJS guest share one source of truth for every fake. What is new is the guest's
// runOnce (no node:vm, no setImmediate: the host drains a macrotask queue) and the few web classes a QuickJS context
// lacks (URL, URLSearchParams, TextEncoder, TextDecoder), as small guest-side polyfills.
//
//   guestBootstrap() -> string   one script; evaluated first in each fresh context, it leaves `globalThis.__lineQ`
//                                ({setup, define, start, drain}), which the host takes and deletes before any unit code
//                                runs. Everything else lives in the script's closure, never on the global.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ts } from '@construct/ast/lazy';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(HERE, '..', 'isolatedChild.cjs');
const RECORDER = path.join(HERE, '..', '..', 'graph', 'runtime', 'recorder.cjs');
/** The recorder declarations the fakes call. */
const RECORDER_NAMES = new Set(['MAX_DEPTH', 'MAX_KEYS', 'WRAPPED', 'DATA_KEY', 'shapeOf', 'ID_SEGMENT', 'urlPattern']);
/** isolatedChild.cjs declarations the guest replaces (runOnce, main) or must not have (the node requires). */
const CHILD_SKIP = new Set(['fs', 'path', 'vm', 'shapeOf', 'urlPattern', 'runOnce', 'main']);

/** The names a top-level statement declares (a destructured require declares several). */
function declared(st) {
  if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) return st.name ? [st.name.text] : [];
  if (!ts.isVariableStatement(st)) return [];
  const out = [];
  const walk = (n) => { if (ts.isIdentifier(n)) out.push(n.text); else n.elements?.forEach((e) => e.name && walk(e.name)); };
  for (const d of st.declarationList.declarations) walk(d.name);
  return out;
}

/** The top-level declarations of `file` that `keep(names)` accepts, as source text in file order. */
function slice(file, keep) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const parts = [];
  for (const st of sf.statements) {
    const names = declared(st);
    if (names.length && keep(names)) parts.push(text.slice(st.getFullStart(), st.getEnd()));
  }
  return parts.join('\n');
}

// Guest-side web classes (a vm context got node's). Small and deterministic; enough for the fakes (the router's
// searchParams) and ordinary unit code (URL parsing, query strings, UTF-8 bytes).
const POLYFILLS = String.raw`
const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+');
const dec = (s) => { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch { return String(s); } };
class URLSearchParams {
  constructor(init) {
    this._p = [];
    if (typeof init === 'string') { for (const kv of init.replace(/^\?/, '').split('&')) if (kv) { const i = kv.indexOf('='); this._p.push(i < 0 ? [dec(kv), ''] : [dec(kv.slice(0, i)), dec(kv.slice(i + 1))]); } }
    else if (Array.isArray(init)) for (const [k, v] of init) this._p.push([String(k), String(v)]);
    else if (init && typeof init === 'object') for (const k of Object.keys(init)) this._p.push([k, String(init[k])]);
  }
  get size() { return this._p.length; }
  append(k, v) { this._p.push([String(k), String(v)]); }
  delete(k) { this._p = this._p.filter(([x]) => x !== String(k)); }
  get(k) { const e = this._p.find(([x]) => x === String(k)); return e ? e[1] : null; }
  getAll(k) { return this._p.filter(([x]) => x === String(k)).map((e) => e[1]); }
  has(k) { return this._p.some(([x]) => x === String(k)); }
  set(k, v) { const i = this._p.findIndex(([x]) => x === String(k)); if (i < 0) this._p.push([String(k), String(v)]); else { this._p[i] = [String(k), String(v)]; this._p = this._p.filter(([x], j) => j <= i || x !== String(k)); } }
  sort() { this._p.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); }
  forEach(cb, self) { for (const [k, v] of this._p) cb.call(self, v, k, this); }
  keys() { return this._p.map((e) => e[0])[Symbol.iterator](); }
  values() { return this._p.map((e) => e[1])[Symbol.iterator](); }
  entries() { return this._p.map((e) => [e[0], e[1]])[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
  toString() { return this._p.map(([k, v]) => enc(k) + '=' + enc(v)).join('&'); }
}
const URL_RE = /^([a-z][a-z0-9+.-]*:)\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?#]*)(?::(\d+))?([^?#]*)(\?[^#]*)?(#.*)?$/i;
class URL {
  constructor(input, base) {
    let s = String(input);
    if (!URL_RE.test(s)) {
      if (base === undefined) throw new TypeError('Invalid URL');
      const b = new URL(base);
      s = s.startsWith('/') ? b.origin + s : b.origin + b.pathname.replace(/[^/]*$/, '') + s;
    }
    const m = URL_RE.exec(s);
    if (!m) throw new TypeError('Invalid URL');
    this.protocol = m[1].toLowerCase(); this.username = m[2] ?? ''; this.password = m[3] ?? ''; this.hostname = (m[4] ?? '').toLowerCase();
    this.port = m[5] ?? ''; this.pathname = m[6] || '/'; this.hash = m[8] ?? '';
    this.searchParams = new URLSearchParams(m[7] ?? '');
  }
  get host() { return this.hostname + (this.port ? ':' + this.port : ''); }
  get origin() { return this.protocol + '//' + this.host; }
  get search() { const q = this.searchParams.toString(); return q ? '?' + q : ''; }
  get href() { return this.origin + this.pathname + this.search + this.hash; }
  toString() { return this.href; }
  toJSON() { return this.href; }
}
class TextEncoder {
  get encoding() { return 'utf-8'; }
  encode(s = '') { const u = unescape(encodeURIComponent(String(s))); const out = new Uint8Array(u.length); for (let i = 0; i < u.length; i++) out[i] = u.charCodeAt(i); return out; }
}
class TextDecoder {
  get encoding() { return 'utf-8'; }
  decode(b) { if (!b) return ''; const a = b instanceof Uint8Array ? b : new Uint8Array(b.buffer ?? b); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); try { return decodeURIComponent(escape(s)); } catch { return s; } }
}
`;

// The guest's runOnce: isolatedChild.cjs's runOnce with the vm context replaced by this QuickJS context (fresh per run),
// vm.runInContext replaced by the module functions the host defines (`define`), and setImmediate replaced by a
// macrotask queue the host drains between job runs. Code generation from strings is switched off before the unit runs
// (eval, Function and the async/generator Function constructors throw EvalError, as under codeGeneration.strings:false).
const RUN = String.raw`
const macro = [];
const nextMacrotask = () => new Promise((r) => macro.push(r));
const mods = Object.create(null);
let state = null;
const UNFAKED = ['process', 'require', 'module', 'Buffer', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'indexedDB', 'navigator', 'window', 'document', 'location', 'history', 'Worker', 'setImmediate', 'importScripts'];
function setup(envJson) {
  const env = JSON.parse(envJson);
  const f = createFakes(env);
  const harness = createHookHarness(f);
  f.MODULES.react = harness.module;
  const g = globalThis;
  for (const name of UNFAKED) Object.defineProperty(g, name, { get: () => f.refuse(name), configurable: false });
  Object.assign(g, {
    fetch: f.fetch, localStorage: f.storage('local'), sessionStorage: f.storage('session'), console: f.consoleFake, analytics: f.analytics,
    setTimeout: f.clock.setTimeout, setInterval: f.clock.setInterval, clearTimeout: f.clock.clearTimeout, clearInterval: f.clock.clearInterval,
    queueMicrotask: f.clock.queueMicrotask, URL, URLSearchParams, TextEncoder, TextDecoder,
  });
  const D = Date;
  const now = f.clock.now;
  class FakeDate extends D { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } }
  g.Date = FakeDate;
  Math.random = f.random;
  state = { f, harness, env };
}
function define(file, fn) { mods[file] = fn; }
function lockCodeGeneration() {
  const refuse = function Function() { throw new EvalError('Code generation from strings disallowed for this context'); };
  const proto = Object.getPrototypeOf;
  for (const sample of [function () {}, async function () {}, function* () {}, async function* () {}]) {
    Object.defineProperty(proto(sample), 'constructor', { value: refuse, writable: false, configurable: false });
  }
  refuse.prototype = proto(function () {});
  Object.defineProperty(globalThis, 'Function', { value: refuse, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'eval', { value: function () { throw new EvalError('Code generation from strings disallowed for this context'); }, writable: true, configurable: true });
}
async function start(sideJson, argsJson) {
  const side = JSON.parse(sideJson);
  const args = JSON.parse(argsJson);
  const { f, harness, env } = state;
  lockCodeGeneration();
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const req = (spec) => {
      if (spec.startsWith('.')) {
        const target = side.resolved[file]?.[spec];
        if (target) return load(target);
        return side.missing[file]?.includes(spec) ? f.spyModule(spec) : f.refuse('import ' + spec);
      }
      if (Object.prototype.hasOwnProperty.call(f.MODULES, spec)) return f.MODULES[spec];
      return f.refuse('import ' + spec);
    };
    const fn = mods[file];
    if (typeof fn !== 'function') throw new Error('module ' + file + ' was not defined');
    fn(mod.exports, req, mod);
    return mod.exports;
  };
  const callArgs = args.map((a) => (a && typeof a === 'object' && typeof a.__lineEvent === 'string' ? syntheticEvent(f, a, env) : a));
  const settle = async () => { f.clock.runAll(); await nextMacrotask(); f.clock.runAll(); };
  let output;
  let thrown = null;
  let entry;
  try {
    entry = load(side.entry);
    const unit = entry.__lineUnit;
    if (typeof unit !== 'function') throw new TypeError(side.fn + ' is not a function');
    if (side.runAs === 'hook') {
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
    // QuickJS names a stack overflow InternalError; V8 (the vm path) throws RangeError: same verdict on both
    const stack = e && e.name === 'InternalError' && /stack overflow/.test(String(e.message));
    if (e && e.name === 'InternalError' && /out of memory/.test(String(e.message))) throw e;
    thrown = stack ? 'RangeError' : e && typeof e.name === 'string' && /^[A-Z]\w*$/.test(e.name) ? e.name : 'Error';
  }
  const plain = (o) => { try { return JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === 'function' ? 'fn' : v))); } catch { return undefined; } };
  const value = output === null || ['boolean', 'number', 'string'].includes(typeof output) ? output : side.runAs === 'hook' && !thrown ? plain(output) : undefined;
  return JSON.stringify({
    run: {
      inputs: callArgs.map((a, k) => (a !== args[k] ? 'event' : shapeOf(a))), output: thrown ? 'undefined' : shapeOf(output), thrown, effects: f.effects, transitions: f.transitions,
      sentinels: findSentinels(json(output) + f.effects.flatMap((e) => e.sentinels).map((s) => '__line_' + s + '__').join(' ')),
    },
    value: typeof value === 'number' && !Number.isFinite(value) ? String(value) : value,
    notFaked: [...f.notFaked].sort(),
    cov: coverageOf(entry ?? cache.get(side.entry)?.exports, side.blocks),
  });
}
/** Resolve the oldest queued macrotask (setImmediate's place); false when none is queued. */
function drain() { const r = macro.shift(); if (!r) return false; r(); return true; }
`;

let cached = null;
/** The bootstrap script (built once per process). */
export function guestBootstrap() {
  if (cached) return cached;
  const recorder = slice(RECORDER, (names) => names.every((n) => RECORDER_NAMES.has(n)));
  const child = slice(CHILD, (names) => !names.some((n) => CHILD_SKIP.has(n)));
  for (const need of ['createFakes', 'createHookHarness', 'syntheticEvent', 'coverageOf', 'findSentinels', 'json']) {
    if (!new RegExp(`(?:function|const|class)\\s+${need}\\b`).test(child)) throw new Error(`quickjs guest: ${need} not found in isolatedChild.cjs`);
  }
  if (!/function shapeOf/.test(recorder) || !/function urlPattern/.test(recorder)) throw new Error('quickjs guest: shapeOf/urlPattern not found in recorder.cjs');
  cached = `(function () {\n'use strict';\n${POLYFILLS}\n${recorder}\n${child}\n${RUN}\nglobalThis.__lineQ = { setup, define, start, drain };\n})();`;
  return cached;
}
