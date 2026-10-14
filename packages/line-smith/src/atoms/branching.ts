// Branching atoms: the ternary, if/else-if chains and switch, as expressions.
import type { Lazy } from './logic';

/** A branch condition: a value (tested for truthiness) or a thunk, evaluated only when reached. */
export type Condition = unknown;

function test(condition: Condition): unknown {
  return typeof condition === 'function' ? (condition as Lazy<unknown>)() : condition;
}

/**
 * when(c, () => a, () => b) reads "when c yields a otherwise b".
 * Exactly `c ? a : b` (and if/else as an expression); only the chosen branch runs.
 * Without the third argument it is `if (c) a` and returns undefined when c is falsy.
 */
export function when<A>(condition: unknown, then: Lazy<A>): A | undefined;
export function when<A, B>(condition: unknown, then: Lazy<A>, otherwise: Lazy<B>): A | B;
export function when(condition: unknown, then: Lazy<unknown>, otherwise?: Lazy<unknown>): unknown {
  if (condition) {
    return then();
  }
  return otherwise ? otherwise() : undefined;
}

/**
 * choose([[c1, () => a], [c2, () => b]], () => fallback) reads "chooses when c1 yields a when c2 yields b otherwise fallback".
 * Exactly an `if (c1) … else if (c2) … else …` chain: the first truthy condition wins, later
 * conditions and bodies never run. A condition may be a thunk (`() => c2`) so it is only
 * evaluated when reached, as in a real else-if; a plain value is tested as-is.
 */
export function choose<C extends ReadonlyArray<readonly [Condition, Lazy<unknown>]>, F = undefined>(
  cases: C,
  fallback?: Lazy<F>,
): ReturnType<C[number][1]> | F {
  for (const [condition, body] of cases) {
    if (test(condition)) {
      return body() as ReturnType<C[number][1]>;
    }
  }
  return (fallback ? fallback() : undefined) as F;
}

type Key = string | number;
type BranchOf<C, V extends PropertyKey> = C extends { readonly [K in V]?: infer B } ? B : never;
type ResultOf<B> = B extends Lazy<infer R> ? R : never;

const own = Object.prototype.hasOwnProperty;

/**
 * match(value, cases, () => fallback) reads "matches value value on k yields a otherwise fallback".
 * Exactly `switch (value) { case k: … default: … }` with === matching on string or number keys.
 * Without a fallback the cases must cover every member of a string/number literal union
 * (a missing case is a compile error), and a value outside the union throws TypeError at runtime.
 */
export function match<V extends Key, C extends { readonly [K in V]: Lazy<unknown> }>(
  value: string extends V ? never : number extends V ? never : V,
  cases: C,
): ResultOf<C[V]>;
export function match<V extends Key, C extends { readonly [K in V]?: Lazy<unknown> }, F>(
  value: V,
  cases: C,
  fallback: Lazy<F>,
): ResultOf<NonNullable<BranchOf<C, V>>> | F;
export function match(value: Key, cases: Record<string, Lazy<unknown>>, fallback?: Lazy<unknown>): unknown {
  // value === value rules out NaN, which no switch case ever matches.
  if (value === value && own.call(cases, value)) {
    return cases[value as string]();
  }
  if (fallback) {
    return fallback();
  }
  throw new TypeError(`match: no case for ${String(value)}`);
}
