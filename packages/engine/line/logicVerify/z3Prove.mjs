// Line logic verification, step 6 (spec C3): the Z3 layer for pure units. Translates the before and after function
// (z3Translate.mjs subset), asks Z3 for an input where they return different values, and answers as a LayerResult:
//   unsat    -> same-behaviour (a proof for every input; only a closed-set transform turns it into "proven")
//   sat      -> changed, with the model as `input` (one value per param, in order) and the differing expression's location
//   unknown  -> cant-tell (the per-proof timeout, or Z3 gave up)
//   outside the subset, or no such function -> skipped, so the next layer (fast-check) decides
// z3-solver (MIT, WASM) loads lazily, once per process.
import { parseToAst } from '@construct/ast/parse';
import { Unsupported, findFunction, translateFunction } from './z3Translate.mjs';
import { locateUnitDifference } from './canonical.mjs';

/** @typedef {import('./contract.mjs').LayerResult} LayerResult */
/** @typedef {import('./z3Translate.mjs').Ir} Ir */
/** @typedef {import('./z3Translate.mjs').FreeVar} FreeVar */

/** The default per-proof budget (spec G: per unit, milliseconds; this is the ceiling, not the norm). */
export const Z3_TIMEOUT_MS = 2000;

/** @type {Promise<any>|null} */
let z3Ready = null;
/** The shared Z3 context, initialised on first use (about 60 ms in Node). */
function z3() {
  z3Ready ??= import('z3-solver').then(async ({ init }) => {
    const { Context } = await init();
    return Context('line');
  });
  return z3Ready;
}

/**
 * Lower an IR tree to a Z3 term. Numbers are IEEE doubles rounded to nearest-even, as JS computes them.
 * @param {any} Z The Z3 context.
 * @param {Ir} ir
 * @param {Map<string, any>} consts Free variable name -> Z3 constant.
 * @returns {any}
 */
function lower(Z, ir, consts) {
  const F64 = Z.Float.sort64();
  const rm = Z.FloatRM.RNE();
  const go = (n) => lower(Z, n, consts);
  switch (ir.k) {
    case 'var': return consts.get(ir.name);
    case 'lit':
      if (ir.sort === 'num') return Z.Float.val(/** @type {number} */ (ir.v), F64);
      if (ir.sort === 'str') return Z.String.val(/** @type {string} */ (ir.v));
      return Z.Bool.val(/** @type {boolean} */ (ir.v));
    case 'not': return Z.Not(go(ir.a));
    case 'and': return Z.And(go(ir.a), go(ir.b));
    case 'or': return Z.Or(go(ir.a), go(ir.b));
    case 'truthy': {
      const a = go(ir.a);
      return ir.a.sort === 'num' ? Z.Not(Z.Or(a.isZero(), a.isNaN())) : Z.Not(Z.Eq(a, Z.String.val('')));
    }
    case 'cmp': {
      const a = go(ir.a);
      const b = go(ir.b);
      return ir.op === '<' ? a.lt(b) : ir.op === '<=' ? a.le(b) : ir.op === '>' ? a.gt(b) : a.ge(b);
    }
    case 'eq': {
      const a = go(ir.a);
      const b = go(ir.b);
      // JS === on numbers is IEEE equality: NaN is never equal, +0 equals -0
      const eq = ir.a.sort === 'num' ? Z.And(Z.Not(a.isNaN()), Z.Not(b.isNaN()), Z.Not(a.lt(b)), Z.Not(a.gt(b))) : Z.Eq(a, b);
      return ir.neg ? Z.Not(eq) : eq;
    }
    case 'arith': {
      const a = go(ir.a);
      const b = go(ir.b);
      return ir.op === '+' ? a.add(rm, b) : ir.op === '-' ? a.sub(rm, b) : ir.op === '*' ? a.mul(rm, b) : a.div(rm, b);
    }
    case 'neg': return go(ir.a).neg();
    case 'concat': return Z.Concat(go(ir.a), go(ir.b));
    case 'ite': return Z.If(go(ir.c), go(ir.a), go(ir.b));
    default: throw new Unsupported(`The IR node ${/** @type {any} */ (ir).k} is outside the Z3 subset.`);
  }
}

/** A model value as a plain JS value. */
function valueOf(Z, sort, e) {
  if (sort === 'bool') return Z.isTrue(e);
  if (sort === 'str') return e.asString();
  return e.value();
}

/** The counterexample in param order: a primitive per primitive param, an object for an object param. */
function inputOf(vars, values, arity) {
  const out = Array.from({ length: arity }, () => undefined);
  for (const v of vars) {
    const i = Number(v.name.slice(1).split('.')[0]);
    if (v.path.length === 0) { out[i] = values.get(v.name); continue; }
    out[i] ??= {};
    let o = out[i];
    v.path.slice(0, -1).forEach((k) => { o = (o[k] ??= {}); });
    o[v.path.at(-1)] = values.get(v.name);
  }
  return out;
}

/**
 * Prove two translated functions equal, or find an input where they differ.
 * @param {{vars: FreeVar[], body: Ir}} before
 * @param {{vars: FreeVar[], body: Ir}} after
 * @param {{timeoutMs?: number, arity?: number}} [opts]
 * @returns {Promise<{result: 'same'|'differs'|'unknown', input?: unknown[], reason?: string}>}
 */
export async function proveEqual(before, after, { timeoutMs = Z3_TIMEOUT_MS, arity } = {}) {
  if (before.body.sort !== after.body.sort) throw new Unsupported(`Return values of two types (${before.body.sort}, ${after.body.sort}) are outside the Z3 subset.`);
  const vars = new Map();
  for (const v of [...before.vars, ...after.vars]) {
    const seen = vars.get(v.name);
    if (seen && seen.sort !== v.sort) throw new Unsupported(`A param whose type changed (${v.name}) is outside the Z3 subset.`);
    vars.set(v.name, v);
  }
  // #882: one check in flight at a time. A second `check()` started while another still runs never returns (z3-solver
  // runs checks on one pthread), and the JS guard below can answer before Z3's own timeout stops a check (a loaded
  // machine), so the next proof waits here until the previous check has really settled.
  const turn = z3Turn;
  /** @type {() => void} */
  let release = () => {};
  z3Turn = new Promise((resolve) => { release = resolve; });
  /** @type {Promise<unknown>} */
  let settled = Promise.resolve();
  try {
    await turn;
    return await proveInTurn(before, after, vars, timeoutMs, arity, (check) => { settled = check.catch(() => {}); });
  } finally {
    settled.then(release, release);
  }
}

/** Serialises Z3 checks: resolves once the previous proof's check has settled (see proveEqual). */
let z3Turn = Promise.resolve();

/**
 * The Z3 part of proveEqual, run in its turn. `onCheck` receives the running check so the turn ends when it settles.
 * @param {{vars: FreeVar[], body: Ir}} before
 * @param {{vars: FreeVar[], body: Ir}} after
 * @param {Map<string, FreeVar>} vars
 * @param {number} timeoutMs
 * @param {number|undefined} arity
 * @param {(check: Promise<unknown>) => void} onCheck
 * @returns {Promise<{result: 'same'|'differs'|'unknown', input?: unknown[], reason?: string}>}
 */
async function proveInTurn(before, after, vars, timeoutMs, arity, onCheck) {
  const Z = await z3();
  const F64 = Z.Float.sort64();
  const consts = new Map([...vars.values()].map((v) => [v.name, v.sort === 'num' ? Z.Float.const(v.name, F64) : v.sort === 'str' ? Z.String.const(v.name) : Z.Bool.const(v.name)]));
  const solver = new Z.Solver();
  solver.set('timeout', Math.max(1, Math.round(timeoutMs)));
  // same JS value: Object.is for numbers (NaN equals NaN, -0 differs from +0), which is what Z3's = means on doubles
  solver.add(Z.Not(Z.Eq(lower(Z, before.body, consts), lower(Z, after.body, consts))));
  let timer;
  const guard = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs + 250); });
  const check = solver.check();
  onCheck(check);
  const res = await Promise.race([check, guard]);
  clearTimeout(timer);
  // The guard answered first: the check still runs, so no further call on this solver (it would wait on that check).
  if (res === 'timeout') return { result: 'unknown', reason: `Z3 hit the ${timeoutMs} ms timeout` };
  if (res === 'unsat') return { result: 'same' };
  if (res === 'sat') {
    const model = solver.model();
    const values = new Map([...vars.values()].map((v) => [v.name, valueOf(Z, v.sort, model.eval(consts.get(v.name), true))]));
    return { result: 'differs', input: inputOf([...vars.values()], values, arity ?? Math.max(0, ...[...vars.values()].map((v) => Number(v.name.slice(1).split('.')[0]) + 1))) };
  }
  const why = solver.reasonUnknown?.() ?? 'unknown';
  return { result: 'unknown', reason: /timeout|canceled/.test(why) ? `Z3 hit the ${timeoutMs} ms timeout` : `Z3 could not decide (${why})` };
}

/**
 * The Z3 layer for one pure unit.
 * @param {{beforeSource: string, afterSource: string, fn: string, beforeFn?: string, file: string, timeoutMs?: number}} args
 *   `file` is the unit's app-relative after file (for the location); `beforeFn` the unit's name before a rename.
 * @returns {Promise<LayerResult>}
 */
export async function z3Layer({ beforeSource, afterSource, fn, beforeFn = fn, file, timeoutMs = Z3_TIMEOUT_MS }) {
  const t0 = performance.now();
  const done = (r) => ({ layer: /** @type {const} */ ('z3'), ...r, ms: Math.round(performance.now() - t0) });
  let bAst;
  let aAst;
  try {
    bAst = parseToAst(beforeSource);
    aAst = parseToAst(afterSource);
  } catch (e) {
    return done({ outcome: 'skipped', reason: `parse error: ${e?.message ?? e}` });
  }
  const bFn = findFunction(bAst, beforeFn);
  const aFn = findFunction(aAst, fn);
  if (!bFn || !aFn) return done({ outcome: 'skipped', reason: `${fn} is not a top-level function on both sides` });
  if (bFn.params.length !== aFn.params.length) return done({ outcome: 'skipped', reason: 'the param count changed' });
  let proof;
  try {
    proof = await proveEqual(translateFunction(bAst, bFn), translateFunction(aAst, aFn), { timeoutMs, arity: aFn.params.length });
  } catch (e) {
    if (e instanceof Unsupported) return done({ outcome: 'skipped', reason: e.message });
    throw e;
  }
  if (proof.result === 'same') return done({ outcome: 'same-behaviour' });
  if (proof.result === 'unknown') return done({ outcome: 'cant-tell', reason: proof.reason });
  const location = locateUnitDifference({ source: beforeSource, file, fn: beforeFn }, { source: afterSource, file, fn });
  return done({ outcome: 'changed', input: proof.input, ...(location ? { location } : {}) });
}
