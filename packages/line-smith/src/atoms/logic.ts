// Logic atoms: exactly what ! && || ?? return, with the right side as a thunk
// so it short-circuits (is never evaluated) exactly when the operator would.

/** A deferred value: the right side of && || ?? or a branch body. */
export type Lazy<T> = () => T;

/** The values JS treats as false. */
export type Falsy = false | 0 | 0n | '' | null | undefined;

/** The falsy part of A (what `a && b` can return from its left side). */
export type FalsyOf<A> = A extends Falsy
  ? A
  : A extends number
    ? number
    : A extends string
      ? ''
      : A extends bigint
        ? 0n
        : never;

/** The truthy part of A (what `a || b` can return from its left side). */
export type TruthyOf<A> = Exclude<A, Falsy>;

/**
 * not(a) reads "not a".
 * Exactly `!a`.
 */
export function not(a: unknown): boolean {
  return !a;
}

/**
 * and(a, () => b) reads "checks if a and b".
 * Exactly `a && b`: returns a when a is falsy (b is never evaluated), else b.
 * The legacy eager form and(a: boolean, b: boolean) is kept for older Smith callers.
 */
export function and(a: boolean, b: boolean): boolean;
export function and<A, B>(a: A, b: Lazy<B>): FalsyOf<A> | B;
export function and(a: unknown, b: unknown): unknown {
  if (!a) {
    return a;
  }
  return typeof b === 'function' ? (b as Lazy<unknown>)() : b;
}

/**
 * or(a, () => b) reads "a or b".
 * Exactly `a || b`: returns a when a is truthy (b is never evaluated), else b.
 * The legacy eager form or(a: boolean, b: boolean) is kept for older Smith callers.
 */
export function or(a: boolean, b: boolean): boolean;
export function or<A, B>(a: A, b: Lazy<B>): TruthyOf<A> | B;
export function or(a: unknown, b: unknown): unknown {
  if (a) {
    return a;
  }
  return typeof b === 'function' ? (b as Lazy<unknown>)() : b;
}

/**
 * orElse(a, () => b) reads "a, or else b".
 * Exactly `a ?? b`: returns a unless it is null or undefined (then b is evaluated).
 */
export function orElse<A, B>(a: A, b: Lazy<B>): NonNullable<A> | B {
  if (a === null || a === undefined) {
    return b();
  }
  return a as NonNullable<A>;
}
