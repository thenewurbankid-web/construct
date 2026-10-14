// Arithmetic atoms: exactly the JS operators, numbers or bigints (never mixed).

/**
 * plus(a, b) reads "a plus b".
 * Exactly `a + b` for numbers (or bigints). Text joins with join(), never plus().
 */
export function plus(a: number, b: number): number;
export function plus(a: bigint, b: bigint): bigint;
export function plus(a: any, b: any): any {
  return a + b;
}

/**
 * join(a, b) reads "a joined with b".
 * Exactly `a + b` for text (string concatenation).
 */
export function join(a: string, b: string): string {
  return a + b;
}

/**
 * minus(a, b) reads "a minus b".
 * Exactly `a - b`.
 */
export function minus(a: number, b: number): number;
export function minus(a: bigint, b: bigint): bigint;
export function minus(a: any, b: any): any {
  return a - b;
}

/**
 * times(a, b) reads "a times b".
 * Exactly `a * b`.
 */
export function times(a: number, b: number): number;
export function times(a: bigint, b: bigint): bigint;
export function times(a: any, b: any): any {
  return a * b;
}

/**
 * dividedBy(a, b) reads "a divided by b".
 * Exactly `a / b` (number division gives Infinity/NaN on zero; bigint division throws RangeError).
 */
export function dividedBy(a: number, b: number): number;
export function dividedBy(a: bigint, b: bigint): bigint;
export function dividedBy(a: any, b: any): any {
  return a / b;
}

/**
 * remainder(a, b) reads "the remainder of a divided by b".
 * Exactly `a % b` (sign follows a, like JS).
 */
export function remainder(a: number, b: number): number;
export function remainder(a: bigint, b: bigint): bigint;
export function remainder(a: any, b: any): any {
  return a % b;
}

/**
 * power(a, b) reads "a to the power of b".
 * Exactly `a ** b`.
 */
export function power(a: number, b: number): number;
export function power(a: bigint, b: bigint): bigint;
export function power(a: any, b: any): any {
  return a ** b;
}

/**
 * negate(a) reads "negative a".
 * Exactly `-a`.
 */
export function negate(a: number): number;
export function negate(a: bigint): bigint;
export function negate(a: any): any {
  return -a;
}
