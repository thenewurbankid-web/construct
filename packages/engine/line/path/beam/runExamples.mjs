// #949 Trace beam, prune stage 3 (behaviour): run finished functions on a spec point's examples, no model.
//   runOnExamples(root, fn, examples, {sandbox})  one function, each example's input -> output compared with `expect`
// Sandbox: 'quickjs' once the QuickJS backend (#947, private/exp/quickjs-sandbox: logicVerify/quickjs/quickjsRun.mjs)
// has landed on this branch; until then (and whenever it is missing) the node:vm fallback below: the file and its
// relative imports transpiled by TypeScript to CommonJS, run in a fresh vm context per example with an in-memory
// localStorage, the typed-contracts factories as identity, a 1 s time limit, and every other bare import refused.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { ts } from '../../../lsp/host.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUICKJS = path.resolve(HERE, '../../logicVerify/quickjs/quickjsRun.mjs');
const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.json'];
/**
 * Whether the QuickJS backend is on this branch.
 * @returns {boolean}
 */
export const quickjsLanded = () => fs.existsSync(QUICKJS);

/**
 * Stable JSON (sorted keys) for comparing outputs.
 * @param {unknown} v
 * @returns {string}
 */
export function stable(v) {
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const ids = (v) => (Array.isArray(v) ? v.map((x) => x?.id ?? x) : v);

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear() };
}

function resolveRel(root, from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, `index${e}`))]) {
    if (c.startsWith(path.resolve(root)) && fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** Load one file of the project in `context` (CommonJS after transpiling), with its relative imports. */
function load(root, abs, context, cache) {
  if (cache.has(abs)) return cache.get(abs).exports;
  if (abs.endsWith('.json')) { const v = JSON.parse(fs.readFileSync(abs, 'utf8')); cache.set(abs, { exports: v }); return v; }
  const mod = { exports: {} };
  cache.set(abs, mod);
  const js = ts.transpileModule(fs.readFileSync(abs, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const req = (spec) => {
    if (/typed-contracts$/.test(spec)) return new Proxy({}, { get: (_t, k) => (String(k).startsWith('define') ? (...a) => a.find((x) => typeof x === 'function') : undefined) });
    if (!spec.startsWith('.')) throw new Error(`NOT_FAKED ${spec}`);
    const f = resolveRel(root, abs, spec);
    if (!f) throw new Error(`NO_FILE ${spec}`);
    return load(root, f, context, cache);
  };
  vm.runInContext(`(function (exports, require, module) {${js}\n})`, context, { filename: abs, timeout: 1000 })(mod.exports, req, mod);
  return mod.exports;
}

/**
 * Run one finished function on examples.
 * @param {string} root
 * @param {{file: string, name: string}} fn
 * @param {{id: string, input?: unknown, args?: unknown[], expect: unknown, compare?: 'ids'|'exact'}[]} examples `args`
 *   for positional calls, else `input` is the one argument (`undefined` calls with none).
 * @param {{sandbox?: 'vm'|'quickjs'}} [o]
 * @returns {{ok: boolean, sandbox: string, quickjs?: string, results: {id: string, pass: boolean, got?: unknown, error?: string}[], failing: any|null, ms: number}}
 */
export function runOnExamples(root, fn, examples, o = {}) {
  const t0 = performance.now();
  const results = [];
  for (const ex of examples) {
    const context = vm.createContext({ localStorage: fakeStorage(), console: { log() {}, warn() {}, error() {} } });
    vm.runInContext('globalThis.globalThis = globalThis;', context);
    try {
      const m = load(root, path.resolve(root, fn.file), context, new Map());
      const f = m[fn.name];
      if (typeof f !== 'function') throw new Error(`NO_EXPORT ${fn.name}`);
      const got = vm.runInContext('(f, a) => f(...a)', context, { timeout: 1000 })(f, ex.args ?? (ex.input === undefined ? [] : [ex.input]));
      const plain = got === undefined ? undefined : JSON.parse(JSON.stringify(got));
      const pass = ex.compare === 'ids' ? stable(ids(plain)) === stable(ids(ex.expect)) : stable(plain) === stable(ex.expect);
      results.push({ id: ex.id, pass, got: plain });
    } catch (e) {
      results.push({ id: ex.id, pass: false, error: String(e?.message ?? e).split('\n')[0].slice(0, 200) });
    }
  }
  const bad = results.find((r) => !r.pass) ?? null;
  const failing = bad ? { ...examples.find((e) => e.id === bad.id), got: bad.got, error: bad.error } : null;
  return { ok: !bad, sandbox: 'vm', ...(o.sandbox === 'quickjs' ? { quickjs: quickjsLanded() ? 'landed, not wired here yet' : 'not landed on this branch' } : {}), results, failing, ms: Math.round(performance.now() - t0) };
}
