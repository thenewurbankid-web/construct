// Runs one atom and its native JS form on independent copies of the same inputs and
// returns comparable outcomes: { ok: value } or { threw: ErrorClass | thrownValue }.
import assert from 'node:assert/strict';

export function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(clone);
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof RegExp) {
    const r = new RegExp(v);
    r.lastIndex = v.lastIndex;
    return r;
  }
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [clone(k), clone(x)]));
  if (v instanceof Set) return new Set([...v].map(clone));
  if (v instanceof WeakMap) return new WeakMap();
  if (v instanceof WeakSet) return new WeakSet();
  if (v instanceof Promise || v instanceof Error) return v;
  const proto = Object.getPrototypeOf(v);
  if (proto === Object.prototype || proto === null) {
    const out = Object.create(proto);
    for (const k of Object.keys(v)) Object.defineProperty(out, k, { value: clone(v[k]), enumerable: true, writable: true, configurable: true });
    return out;
  }
  return v;
}

const protoIds = new WeakMap();
let protoCounter = 0;
function protoId(proto) {
  if (!protoIds.has(proto)) protoIds.set(proto, ++protoCounter);
  return protoIds.get(proto);
}

function normalize(v) {
  if (v instanceof WeakMap || v instanceof WeakSet) return { weak: v.constructor.name };
  if (v && typeof v === 'object') {
    // An object with a custom prototype (Object.create / setPrototypeOf results): compare the
    // prototype by identity and the own keys by value. node's deepStrictEqual otherwise reads
    // the inherited `constructor`, which a generated prototype can set to NaN (never equal).
    const proto = Object.getPrototypeOf(v);
    const builtin = [Object.prototype, Array.prototype, Map.prototype, Set.prototype, Date.prototype, RegExp.prototype, Promise.prototype];
    if (proto !== null && !builtin.includes(proto) && !(v instanceof Error)) {
      return { protoId: protoId(proto), own: Object.fromEntries(Object.entries(v)) };
    }
  }
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.next === 'function' && typeof v[Symbol.iterator] === 'function') {
    return { iterated: Array.from(v, normalize) };
  }
  return v;
}

const thrown = (e) => ({ threw: e instanceof Error ? e.constructor.name : e });

/** The outcome of calling fn, awaiting a promise result. */
export async function outcome(fn) {
  let value;
  try {
    value = fn();
  } catch (e) {
    return thrown(e);
  }
  if (value && typeof value.then === 'function') {
    try {
      return { ok: normalize(await value) };
    } catch (e) {
      return thrown(e);
    }
  }
  return { ok: normalize(value) };
}

export function sameOutcome(actual, expected, label) {
  assert.deepStrictEqual(actual, expected, label);
}

const copiers = new Map();
function copier(expr) {
  if (!copiers.has(expr)) copiers.set(expr, new Function('r', `return ${expr.replaceAll('{r}', 'r')};`));
  return copiers.get(expr);
}

/** Calls the built-in that a generated atom wraps, per its catalog `check.native`. */
export function callNative(native, receiver, args) {
  const owner = globalThis[native.owner];
  switch (native.kind) {
    case 'instance':
    case 'inplace':
      return receiver[native.member](...args);
    case 'copy': {
      const copy = copier(native.copy)(receiver);
      copy[native.member](...args);
      return copy;
    }
    case 'copyReceiver':
      return copier(native.copy)(receiver)[native.member](...args);
    case 'static':
      return owner[native.member](...args);
    case 'staticCopy': {
      const copy = { ...args[0] };
      owner[native.member](copy, ...args.slice(1));
      return copy;
    }
    case 'construct':
      return new owner(...args);
    case 'call':
      return owner(...args);
    case 'global':
      return globalThis[native.member](...args);
    default:
      throw new Error(`unknown native kind ${native.kind}`);
  }
}
