// Number and Math atoms. Pure; randomBetween lives in impure.ts.

/**
 * largestOf(numbers) reads "the largest of numbers".
 * Exactly `Math.max(...numbers)` (-Infinity when empty, NaN if any is NaN), without the
 * argument-count limit of spreading a huge list.
 */
export function largestOf(numbers: readonly number[]): number {
  let out = -Infinity;
  for (const n of numbers) {
    out = Math.max(out, n);
  }
  return out;
}

/**
 * smallestOf(numbers) reads "the smallest of numbers".
 * Exactly `Math.min(...numbers)` (Infinity when empty).
 */
export function smallestOf(numbers: readonly number[]): number {
  let out = Infinity;
  for (const n of numbers) {
    out = Math.min(out, n);
  }
  return out;
}

/**
 * roundedTo(n, digits) reads "n rounded to digits decimal places".
 * Exactly `Math.round(n * 10 ** digits) / 10 ** digits` (so it shares that idiom's binary
 * floating-point edge cases, e.g. 1.005 -> 1). digits defaults to 0.
 */
export function roundedTo(n: number, digits = 0): number {
  return Math.round(n * 10 ** digits) / 10 ** digits;
}

/**
 * floorOf(n) reads "n rounded down".
 * Exactly `Math.floor(n)`.
 */
export function floorOf(n: number): number {
  return Math.floor(n);
}

/**
 * ceilingOf(n) reads "n rounded up".
 * Exactly `Math.ceil(n)`.
 */
export function ceilingOf(n: number): number {
  return Math.ceil(n);
}

/**
 * absoluteOf(n) reads "the absolute value of n".
 * Exactly `Math.abs(n)`.
 */
export function absoluteOf(n: number): number {
  return Math.abs(n);
}

/**
 * clamp(n, min, max) reads "n kept between min and max".
 * Exactly `Math.min(Math.max(n, min), max)`.
 */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * sumOf(numbers) reads "the sum of numbers".
 * Exactly `numbers.reduce((a, b) => a + b, 0)`.
 */
export function sumOf(numbers: readonly number[]): number {
  let total = 0;
  for (const n of numbers) {
    total += n;
  }
  return total;
}

/**
 * averageOf(numbers) reads "the average of numbers".
 * Exactly `numbers.reduce((a, b) => a + b, 0) / numbers.length` (NaN when empty).
 */
export function averageOf(numbers: readonly number[]): number {
  return sumOf(numbers) / numbers.length;
}

/**
 * isWhole(value) reads "value is a whole number".
 * Exactly `Number.isInteger(value)`.
 */
export function isWhole(value: unknown): value is number {
  return Number.isInteger(value);
}

/**
 * parseNumber(text) reads "the number written in text".
 * Exactly `Number.parseFloat(text)` (NaN when text doesn't start with a number).
 */
export function parseNumber(text: string): number {
  return Number.parseFloat(text);
}

/**
 * parseWhole(text) reads "the whole number written in text".
 * Exactly `Number.parseInt(text, 10)`.
 */
export function parseWhole(text: string): number {
  return Number.parseInt(text, 10);
}

/**
 * formatNumber(n, locale, options) reads "n formatted for locale".
 * Exactly `new Intl.NumberFormat(locale, options).format(n)`. locale defaults to 'en-US'
 * (not the machine's locale) so the result is the same everywhere.
 */
export function formatNumber(n: number | bigint, locale = 'en-US', options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(n);
}
