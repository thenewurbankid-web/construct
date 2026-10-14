// IMPURE atoms: results depend on time or randomness. Each takes its source as an
// optional last argument so tests (and Smith) can inject a fixed clock or generator.

/** A clock: milliseconds since the Unix epoch, like Date.now. */
export type Clock = () => number;

/** A random source: a number in [0, 1), like Math.random. */
export type RandomSource = () => number;

/**
 * now(clock) reads "the current date and time". IMPURE.
 * Exactly `new Date(Date.now())`; pass a clock to make it deterministic.
 */
export function now(clock: Clock = Date.now): Date {
  return new Date(clock());
}

/**
 * randomBetween(min, max, random) reads "a random number from min up to max". IMPURE.
 * Exactly `min + Math.random() * (max - min)`: in [min, max); pass random to make it deterministic.
 */
export function randomBetween(min: number, max: number, random: RandomSource = Math.random): number {
  return min + random() * (max - min);
}

/**
 * delay(ms, value) reads "value after ms milliseconds". IMPURE (timer).
 * Exactly `new Promise((resolve) => setTimeout(() => resolve(value), ms))`.
 */
export function delay<T = undefined>(ms: number, value?: T): Promise<T> {
  const timer = (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout;
  return new Promise((resolve) => {
    timer(() => resolve(value as T), ms);
  });
}
