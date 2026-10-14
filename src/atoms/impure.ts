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
 * nowTime(clock) reads "the current time in milliseconds". IMPURE.
 * Exactly `Date.now()`; pass a clock to make it deterministic.
 */
export function nowTime(clock: Clock = Date.now): number {
  return clock();
}

/**
 * random(source) reads "a random number from 0 up to 1". IMPURE.
 * Exactly `Math.random()`; pass a source (e.g. seededSource(42)) to make it deterministic.
 */
export function random(source: RandomSource = Math.random): number {
  return source();
}

/**
 * seededSource(seed) reads "a repeatable random source started from seed".
 * A deterministic RandomSource (mulberry32): the same seed always yields the same sequence
 * of numbers in [0, 1). Calling the returned source advances its own internal state only.
 */
export function seededSource(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * randomBetween(min, max, random) reads "a random number from min up to max". IMPURE.
 * Exactly `min + Math.random() * (max - min)`: in [min, max); pass random to make it deterministic.
 */
export function randomBetween(min: number, max: number, random: RandomSource = Math.random): number {
  return min + random() * (max - min);
}

/** A timer: runs fn after ms milliseconds, like setTimeout. */
export type Schedule = (fn: () => void, ms: number) => unknown;

const realSchedule: Schedule = (fn, ms) => (globalThis as unknown as { setTimeout: Schedule }).setTimeout(fn, ms);

/**
 * delay(ms, value, schedule) reads "value after ms milliseconds". IMPURE (timer).
 * Exactly `new Promise((resolve) => setTimeout(() => resolve(value), ms))`; pass a schedule
 * (a fake timer) to make it deterministic.
 */
export function delay<T = undefined>(ms: number, value?: T, schedule: Schedule = realSchedule): Promise<T> {
  return new Promise((resolve) => {
    schedule(() => resolve(value as T), ms);
  });
}
