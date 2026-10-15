// Time and randomness, made pure (R11): each atom takes its clock or random source as a parameter, so the same
// inputs always give the same result. App code passes Date.now or Math.random; tests pass a fixed one.

/** A clock: milliseconds since the Unix epoch, like Date.now. */
export type Clock = () => number;

/** A random source: a number in [0, 1), like Math.random. */
export type RandomSource = () => number;

/**
 * now(clock) reads "the current date and time". Pure: the clock or source is a parameter.
 * Exactly `new Date(clock())`.
 */
export function now(clock: Clock): Date {
  return new Date(clock());
}

/**
 * nowTime(clock) reads "the current time in milliseconds". Pure: the clock or source is a parameter.
 * Exactly `clock()`.
 */
export function nowTime(clock: Clock): number {
  return clock();
}

/**
 * random(source) reads "a random number from 0 up to 1". Pure: the clock or source is a parameter.
 * Exactly `source()`; seededSource(42) gives a repeatable one.
 */
export function random(source: RandomSource): number {
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
 * randomBetween(min, max, random) reads "a random number from min up to max". Pure: the clock or source is a parameter.
 * Exactly `min + random() * (max - min)`: in [min, max).
 */
export function randomBetween(min: number, max: number, random: RandomSource): number {
  return min + random() * (max - min);
}
