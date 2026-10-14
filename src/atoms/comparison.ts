// Comparison atoms: strict, operator-identical semantics (=== / !== / < / <= / > / >=).

/** Values the ordering operators (< <= > >=) compare sensibly. */
export type Ordered = number | string | bigint | Date;

/**
 * equals(a, b) reads "a equals b".
 * Exactly `a === b`: NaN never equals itself, 0 equals -0, objects compare by reference.
 */
export function equals<T>(a: T, b: T): boolean {
  return a === b;
}

/**
 * differs(a, b) reads "a differs from b".
 * Exactly `a !== b`.
 */
export function differs<T>(a: T, b: T): boolean {
  return a !== b;
}

/**
 * lessThan(a, b) reads "a is less than b".
 * Exactly `a < b`.
 */
export function lessThan<T extends Ordered>(a: T, b: T): boolean {
  return a < b;
}

/**
 * atMost(a, b) reads "a is at most b".
 * Exactly `a <= b`.
 */
export function atMost<T extends Ordered>(a: T, b: T): boolean {
  return a <= b;
}

/**
 * greaterThan(a, b) reads "a is greater than b".
 * Exactly `a > b`.
 */
export function greaterThan<T extends Ordered>(a: T, b: T): boolean {
  return a > b;
}

/**
 * atLeast(a, b) reads "a is at least b".
 * Exactly `a >= b`.
 */
export function atLeast<T extends Ordered>(a: T, b: T): boolean {
  return a >= b;
}
