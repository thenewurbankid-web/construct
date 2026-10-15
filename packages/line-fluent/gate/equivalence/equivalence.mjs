// Equivalence gate (leaf t1-2b, docs/line/FLUENT-PLAN-2026-10-15.md "Wave 2 leaves").
//
//   checkEquivalence(answer, { entry, runs = 50, seed = 1 }) -> { check, errors, fixes: [] }
//
// Runs a C2 answer's `js` against the C1 entry's reference behaviour and says whether they
// do the same thing. `skip` (no errors) for `not-expressible` and `molecule`, and for entry
// kinds with no single member to call (index, type, class, protocol, syntax).
//
// Binding rule (the reference functions in input/ref-*.mjs take no arguments; their inputs
// are literals inside the body, so the binding is not written anywhere):
// - The entry key names one member, e.g. `Array.prototype.flatMap`, `Math.max`, `new URL`,
//   `decodeURI()`. The call shape is fixed by the entry kind:
//     method / property         answer.params[0] is the receiver, the rest are the arguments
//     static / function / call  answer.params are the arguments
//     construct                 answer.params are the constructor arguments
//     static-property           no parameters
//   answer.params bind in order; an answer may bind fewer arguments than the member takes.
// - The expected.json case: the member is wrapped with a spy while the reference function
//   runs, which records the receiver and arguments it was called with. The answer runs on
//   fresh copies of those values (the spy aborts a run before the member is called) and is
//   compared with the member called live on the same values (the values the answer binds; an
//   answer that leaves an optional argument out is compared with the member called without it).
//   The live call, not the stored expected.json value, is the reference, so both sides are
//   described the same way; reference.test.mjs already pins the live run to expected.json. If the
//   spy is not hit (an own data property such as `Array.prototype.length`, or a member reached
//   another way), the case is not bound and only generated inputs are compared.
// - Generated inputs: answer.params types are line-smith generator names
//   (packages/line-smith/test/support/gens.mjs, the vocabulary of catalog `check.params`),
//   sampled with fast-check for a fixed seed. The reference is the member called with them.
// - Compared per run: the return value (promises awaited, 2 s limit) as run.mjs `describe`
//   prints it (an object it prints as `{Tag: {}}` adds its String() when that is not
//   `[object ...]`, so two URLs differ), the error name when it throws, and every bound value after the call (so `in-place` and `copy`
//   differ). Entries marked nondeterministic in map.json compare by kind only.
// - The answer runs in a fresh vm context (Node's non-ES globals such as URL copied in) with a
//   1 s limit for its synchronous part; values cross realms, so an answer using
//   `instanceof Array` on a parameter would see false. Use Array.isArray.
//
// Gate wiring: runGate (../assemble.mjs) is synchronous and calls each injected check as
// (answer) -> CheckResult, so the async check is run first and handed over settled:
//   runGate(answer, { grammar: checkGrammar, equivalence: await equivalenceFor(answer, { entry }) })
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import fc from 'fast-check';
import { describe } from '../../../line-codemod/bench/atoms/js-reference/run.mjs';
import { arb } from '../../../line-smith/test/support/gens.mjs';
import { validateAnswer } from '../../contract/validate.mjs';

const refDir = new URL('../../../line-codemod/bench/atoms/js-reference/', import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, refDir), 'utf8'));
let data = null;
const load = () => (data ??= { reference: readJson('reference.json'), map: readJson('map.json') });

const CALLABLE = new Set(['method', 'property', 'static', 'static-property', 'function', 'call', 'construct']);
const result = (check, errors = []) => ({ check, errors, fixes: [] });
const ABORT = Symbol('equivalence-abort');

async function within(ms, promise) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Run fn: { ok: raw value } or { throws: { name } }. Promises are awaited. */
async function settle(fn) {
  try {
    let v = fn();
    if (v && typeof v.then === 'function') v = await within(2000, v);
    return { ok: v };
  } catch (error) {
    if (error === ABORT) throw error;
    return { throws: { name: error?.name ?? typeof error } };
  }
}

/** run.mjs describe, plus String(v) for an object it prints with no content. */
function see(v) {
  const d = describe(v);
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const keys = Object.keys(d);
    const inner = d[keys[0]];
    if (keys.length === 1 && inner && typeof inner === 'object' && !Object.keys(inner).length) {
      try {
        const text = String(v);
        if (!text.startsWith('[object ')) return { [keys[0]]: text };
      } catch {
        // no string form: keep describe's
      }
    }
  }
  return d;
}

/** C1 entry from an entry object, a key, or an id (first match). */
function findEntry(entry, fallbackId) {
  if (entry && typeof entry === 'object') return entry;
  const { reference } = load();
  const want = entry ?? fallbackId;
  return reference.entries.find((e) => e.key === want) ?? reference.entries.find((e) => e.id === want) ?? null;
}

/** `Array.prototype.[Symbol.iterator] #2` -> { ownerPath: ['Array','prototype'], prop: Symbol.iterator } */
function memberOf(key) {
  const k = key.replace(/\s+#\d+$/, '').replace(/^new\s+/, '').replace(/\(\)$/, '');
  const parts = [];
  for (const m of k.matchAll(/\[Symbol\.(\w+)\]|[^.[\]]+/g)) parts.push(m[1] ? Symbol[m[1]] : m[0]);
  if (!parts.length) return null;
  const prop = parts.pop();
  return { ownerPath: parts, prop };
}

function ownerOf(ownerPath) {
  let o = globalThis;
  for (const p of ownerPath) {
    if (o == null) return undefined;
    o = o[p];
  }
  return o;
}

/** The reference call for a kind, as (values) -> result. */
function referenceCall(kind, member) {
  const owner = () => ownerOf(member.ownerPath);
  switch (kind) {
    case 'method': return ([recv, ...args]) => Reflect.apply(owner()[member.prop], recv, args);
    case 'property': return ([recv]) => recv[member.prop];
    case 'static': return (args) => Reflect.apply(owner()[member.prop], owner(), args);
    case 'static-property': return () => owner()[member.prop];
    case 'function': case 'call': return (args) => Reflect.apply(owner()[member.prop], undefined, args);
    case 'construct': return (args) => Reflect.construct(owner()[member.prop], args);
    default: return null;
  }
}

/**
 * Run `fn` (the reference function) with `member` wrapped. Records the receiver and arguments
 * of the first call made while `fn` itself runs, and throws ABORT before the member runs.
 * Returns { values }, null when the spy was not hit.
 */
async function withSpy(kind, member, fn) {
  const owner = ownerOf(member.ownerPath);
  if (owner == null || (typeof owner !== 'object' && typeof owner !== 'function')) return { values: null };
  const own = Object.getOwnPropertyDescriptor(owner, member.prop);
  let holder = owner;
  while (holder && !Object.getOwnPropertyDescriptor(holder, member.prop)) holder = Object.getPrototypeOf(holder);
  const desc = holder && Object.getOwnPropertyDescriptor(holder, member.prop);
  if (!desc || (own && !own.configurable)) return { values: null };
  let values = null;
  let active = false;
  const record = (v) => {
    if (values || !active) return;
    values = v;
    throw ABORT;
  };
  let spied;
  if (kind === 'property' && desc.get) {
    const get = desc.get;
    spied = { ...desc, get() { record([this]); return Reflect.apply(get, this, []); } };
  } else if (typeof desc.value === 'function') {
    const orig = desc.value;
    const wrap = kind === 'construct' || kind === 'call'
      ? new Proxy(orig, {
        construct(t, args, nt) { record(args); return Reflect.construct(t, args, nt); },
        apply(t, self, args) { record(args); return Reflect.apply(t, self, args); },
      })
      : new Proxy(orig, {
        apply(t, self, args) { record(kind === 'method' ? [self, ...args] : args); return Reflect.apply(t, self, args); },
      });
    spied = { ...desc, value: wrap };
  } else {
    return { values: null };
  }
  try {
    Object.defineProperty(owner, member.prop, spied);
    await settle(() => {
      active = true;
      try {
        return fn();
      } finally {
        active = false;
      }
    });
  } catch {
    // ABORT, or a member that cannot be redefined
  } finally {
    if (own) Object.defineProperty(owner, member.prop, own);
    else delete owner[member.prop];
  }
  return { values };
}

let webCache = null;
/** Node globals a fresh vm context does not have (URL, TextEncoder, structuredClone, ...). */
function webGlobals() {
  if (webCache) return webCache;
  const es = new Set(Object.getOwnPropertyNames(vm.runInNewContext('globalThis')));
  webCache = Object.getOwnPropertyNames(globalThis).filter((n) => !es.has(n) && n !== 'globalThis' && /^[A-Za-z]/.test(n))
    .map((n) => [n, globalThis[n]]);
  return webCache;
}

/** Run the answer's js with names bound to values in a fresh context (shared with clarify/sentences.mjs). */
export function runAnswer(js, names, values) {
  const sandbox = Object.fromEntries(webGlobals());
  names.forEach((n, i) => { sandbox[n] = values[i]; });
  const ctx = vm.createContext(sandbox);
  return settle(() => vm.runInContext(`(${js})`, ctx, { timeout: 1000 }));
}

function kindOnly(o) {
  if (o.throws) return o;
  if (o.ok === null || typeof o.ok !== 'object') return { ok: { kind: typeof o.ok } };
  return { ok: { kind: Array.isArray(o.ok) ? 'array' : Object.keys(o.ok)[0] ?? 'object' } };
}

/** Comparable form of one run: outcome (throws by name) plus the bound values afterwards. */
function shape(r, after, nondeterministic) {
  const o = r.throws ? r : { ok: see(r.ok) };
  return { o: nondeterministic ? kindOnly(o) : o, after: nondeterministic ? null : after.map(see) };
}

const show = (d) => {
  const s = JSON.stringify(d) ?? 'undefined';
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
};
const showOutcome = (o) => (o.throws ? `throws ${o.throws.name}` : `returns ${show(o.ok)}`);
const showInput = (names, values) => names.map((n, i) => `${n} = ${show(see(values[i]))}`).join(', ') || 'no input';

/** One sentence for a mismatch, or null when the runs agree. */
function mismatch(label, names, inputs, answer, ref) {
  const where = `On ${label} ${showInput(names, inputs)}`;
  if (JSON.stringify(answer.o) !== JSON.stringify(ref.o)) {
    return `${where}, the answer ${showOutcome(answer.o)} but the reference ${showOutcome(ref.o)}.`;
  }
  if (answer.after && JSON.stringify(answer.after) !== JSON.stringify(ref.after)) {
    const i = answer.after.findIndex((v, j) => JSON.stringify(v) !== JSON.stringify(ref.after[j]));
    return `${where}, the answer leaves \`${names[i]}\` as ${show(answer.after[i])} but the reference leaves it as ${show(ref.after[i])}.`;
  }
  return null;
}

export async function checkEquivalence(answer, { entry, runs = 50, seed = 1 } = {}) {
  if (!answer || typeof answer !== 'object') return result('fail', ['The answer is not a C2 object; reply with one JSON object holding the C2 fields.']);
  if (answer.decision === 'not-expressible' || answer.decision === 'molecule') return result('skip');
  const e = findEntry(entry, answer.entry);
  if (!e) return result('fail', [`The entry \`${entry ?? answer.entry}\` is not in reference.json; use a C1 entry id or key.`]);
  if (!CALLABLE.has(e.kind)) return result('skip');
  if (typeof answer.js !== 'string' || !answer.js.trim()) return result('fail', ['The answer has no `js` to run; write the JavaScript the sentence stands for.']);
  try {
    new vm.Script(`(${answer.js})`);
  } catch (err) {
    return result('fail', [`The answer's \`js\` does not parse (${err.message}); write one JavaScript expression.`]);
  }
  const params = answer.params ?? [];
  const names = params.map(([n]) => n);
  const arbs = [];
  for (const [n, t] of params) {
    try {
      arbs.push(arb(t));
    } catch {
      return result('fail', [`The parameter \`${n}\` has type \`${t}\`, which is not a generator name; use one of ${['list', 'text', 'num', 'fn', 'pred', 'prim'].join(', ')} or another name from line-smith's gens.`]);
    }
  }
  const { map } = load();
  const key = e.key ?? e.id;
  const member = memberOf(key);
  const call = member && referenceCall(e.kind, member);
  if (!call) return result('skip');
  const nondeterministic = Boolean(map.meta?.[key]?.nondeterministic);
  const errors = [];

  // 1. The expected.json case: the reference function's own inputs, bound through the spy.
  const ref = map.map[key];
  const mod = ref?.fn ? await import(new URL(`input/${ref.file}`, refDir).href) : null;
  const fn = mod?.[ref.fn];
  const fresh = async () => {
    const v = fn ? (await withSpy(e.kind, member, fn)).values : null;
    return v && Array.from({ length: names.length }, (_, i) => v[i]);
  };
  const forAnswer = await fresh();
  if (forAnswer) {
    const forRef = await fresh();
    const a = await runAnswer(answer.js, names, forAnswer);
    const r = await settle(() => call(forRef));
    const msg = mismatch('the reference case', names, await fresh(), shape(a, forAnswer, nondeterministic), shape(r, forRef, nondeterministic));
    if (msg) errors.push(msg);
  }

  // 2. Generated inputs, the same values (sampled twice from one seed) for both sides.
  if (!errors.length && runs > 0) {
    const tuple = fc.tuple(...arbs);
    const sample = () => fc.sample(tuple, { seed, numRuns: runs });
    const forAnswer = sample();
    const forRef = sample();
    const forShow = sample();
    for (let i = 0; i < runs; i++) {
      const a = await runAnswer(answer.js, names, forAnswer[i]);
      const r = await settle(() => call(forRef[i]));
      const msg = mismatch('input', names, forShow[i], shape(a, forAnswer[i], nondeterministic), shape(r, forRef[i], nondeterministic));
      if (msg) {
        errors.push(msg);
        break;
      }
    }
  }
  return result(errors.length ? 'fail' : 'pass', errors);
}

/**
 * The settled check for runGate: runs checkEquivalence once now and returns
 * (answer) -> CheckResult. An answer that fails the C2 schema is not run (runGate skips it anyway).
 */
export async function equivalenceFor(answer, options = {}) {
  const settled = validateAnswer(answer).check === 'fail' ? result('skip') : await checkEquivalence(answer, options);
  return () => settled;
}
