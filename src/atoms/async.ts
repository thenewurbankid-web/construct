// Promise atoms. attemptAsync lives in errors.ts; delay is impure (timers) and lives in impure.ts.

/**
 * allOf(promises) reads "all of promises, once they all succeed".
 * Exactly `Promise.all(promises)`.
 */
export function allOf<T extends readonly unknown[] | []>(promises: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  return Promise.all(promises);
}

/**
 * firstSettled(promises) reads "whichever of promises settles first".
 * Exactly `Promise.race(promises)`.
 */
export function firstSettled<T extends readonly unknown[] | []>(promises: T): Promise<Awaited<T[number]>> {
  return Promise.race(promises);
}

/**
 * settledAll(promises) reads "the outcome of every one of promises".
 * Exactly `Promise.allSettled(promises)`.
 */
export function settledAll<T extends readonly unknown[] | []>(promises: T): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>> }> {
  return Promise.allSettled(promises);
}
