// Runs every function of the reference input and records what Node returns, as plain data.
// Used by reference.test.mjs, and on its own to (re)write expected.json:
//
//   node bench/atoms/js-reference/run.mjs --update     write expected.json from this Node
//   node bench/atoms/js-reference/run.mjs              print a summary only
//   node bench/atoms/js-reference/run.mjs --dir <dir>  run another copy of input/ (the converted one)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { types } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));

// Stable, plain-data description of any value: what the tests compare.
export function describe(value, depth = 0, seen = new Set()) {
  if (depth > 4) return '[deep]';
  const t = typeof value;
  if (value === null) return null;
  if (t === 'undefined') return { undefined: true };
  if (t === 'number') return Number.isNaN(value) ? { number: 'NaN' } : Object.is(value, -0) ? { number: '-0' } : Number.isFinite(value) ? value : { number: String(value) };
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'bigint') return { bigint: String(value) };
  if (t === 'symbol') return { symbol: value.description ?? '' };
  if (t === 'function') return { function: value.name || '(anonymous)', length: value.length };
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const d = (v) => describe(v, depth + 1, seen);
  try {
    if (value instanceof Error || types.isNativeError(value)) return { error: value.name, message: value.message, ...(value.cause !== undefined ? { cause: d(value.cause) } : {}) };
    if (types.isDate(value)) return { date: Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString() };
    if (types.isRegExp(value)) return { regexp: String(value), lastIndex: value.lastIndex };
    if (types.isMap(value)) return { map: [...value].slice(0, 20).map(([k, v]) => [d(k), d(v)]) };
    if (types.isSet(value)) return { set: [...value].slice(0, 20).map(d) };
    if (types.isTypedArray(value)) return { [value.constructor.name]: [...value].slice(0, 32).map(d) };
    if (types.isArrayBuffer(value) || types.isSharedArrayBuffer(value)) return { [value.constructor.name]: [...new Uint8Array(value)].slice(0, 32), byteLength: value.byteLength };
    if (types.isDataView(value)) return { DataView: value.byteLength };
    if (types.isPromise(value)) return { promise: true };
    if (types.isWeakMap(value) || types.isWeakSet(value)) return { [value.constructor.name]: true };
    if (Array.isArray(value)) {
      const out = value.slice(0, 40).map(d);
      const extra = Object.keys(value).filter((k) => !/^\d+$/.test(k));
      return extra.length ? { array: out, props: Object.fromEntries(extra.map((k) => [k, d(value[k])])) } : out;
    }
    if (typeof value.next === 'function' && typeof value[Symbol.iterator] === 'function' && !(Symbol.asyncIterator in value)) {
      const items = [];
      for (const v of value) { items.push(d(v)); if (items.length >= 20) break; }
      return { iterator: Object.prototype.toString.call(value), items };
    }
    const tag = Object.prototype.toString.call(value).slice(8, -1);
    const out = {};
    for (const k of Object.keys(value).filter((key) => key !== 'constructor').slice(0, 30)) out[k] = d(value[k]);
    return tag === 'Object' ? out : { [tag]: out };
  } catch (error) {
    return { describeError: String(error?.message ?? error) };
  }
}

async function within(ms, promise) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

// Run one function: { ok: value } or { throws: { name, message } }. Promises are awaited.
export async function outcome(fn) {
  try {
    let v = fn();
    if (v && typeof v.then === 'function') v = await within(2000, v);
    // An async iterator is read to the end so its values are compared too.
    if (v && typeof v[Symbol.asyncIterator] === 'function' && typeof v.next === 'function') {
      // A prototype object (AsyncGeneratorFunction#prototype) has next() but can't be iterated: describe it instead.
      try {
        const items = [];
        for await (const x of v) { items.push(describe(x)); if (items.length >= 20) break; }
        return { ok: { asyncIterator: items } };
      } catch {
        return { ok: describe(v) };
      }
    }
    return { ok: describe(v) };
  } catch (error) {
    return { throws: { name: error?.name ?? typeof error, message: String(error?.message ?? error).split('\n')[0] } };
  }
}

export async function runAll(dir = join(here, 'input')) {
  const { map, meta } = JSON.parse(readFileSync(join(here, 'map.json'), 'utf8'));
  const modules = new Map();
  const results = {};
  for (const [key, { file, fn }] of Object.entries(map)) {
    if (!fn) continue;
    if (!modules.has(file)) modules.set(file, await import(pathToFileURL(join(dir, file)).href));
    const exported = modules.get(file)[fn];
    const r = exported ? await outcome(exported) : { missing: true };
    // Values that change on every run (clocks, random, GC, the machine) are compared by kind only.
    results[key] = meta[key]?.nondeterministic ? kindOnly(r) : r;
  }
  return results;
}

function kindOnly(r) {
  if (r.throws) return { throws: { name: r.throws.name } };
  if (r.ok === null || typeof r.ok !== 'object') return { ok: { kind: typeof r.ok } };
  return { ok: { kind: Array.isArray(r.ok) ? 'array' : Object.keys(r.ok)[0] ?? 'object' } };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dirArg = process.argv.indexOf('--dir');
  const dir = dirArg > 0 ? resolve(process.argv[dirArg + 1]) : undefined;
  const results = await runAll(dir);
  const keys = Object.keys(results);
  const threw = keys.filter((k) => results[k].throws);
  const byError = {};
  for (const k of threw) { const m = `${results[k].throws.name}: ${results[k].throws.message ?? ''}`.slice(0, 90); byError[m] = (byError[m] ?? 0) + 1; }
  console.log(`${keys.length} run, ${keys.length - threw.length} returned, ${threw.length} threw, ${keys.filter((k) => results[k].missing).length} missing`);
  if (process.argv.includes('--errors')) for (const [m, n] of Object.entries(byError).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${m}`);
  if (process.argv.includes('--list')) for (const k of threw) console.log(`${k}  ->  ${results[k].throws.name}: ${results[k].throws.message}`);
  if (process.argv.includes('--update')) {
    writeFileSync(join(here, 'expected.json'), JSON.stringify({ $comment: `GENERATED by run.mjs --update on Node ${process.version}: what each reference function returns or throws.`, node: process.version, results }, null, 1) + '\n');
    console.log('wrote expected.json');
  }
  process.exit(0);
}
