// Loop atoms: a bounded iteration that returns its final state. Loops run for their effects (forEach, a while
// with a step) are not in the library (R11). There is no unbounded loop atom.

function checkLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError(`loop limit must be a whole number >= 0, got ${String(limit)}`);
  }
}

/**
 * iterateWhile(start, (s) => condition, (s) => next, limit) reads "starting from start, step to next while condition, at most limit times".
 * Threads a state value instead of mutating variables, and
 * returns the final state. Throws RangeError if the limit is reached while condition still holds.
 */
export function iterateWhile<S>(start: S, condition: (state: S) => unknown, next: (state: S) => S, limit: number): S {
  checkLimit(limit);
  let state = start;
  let steps = 0;
  while (condition(state)) {
    if (steps >= limit) {
      throw new RangeError(`iterateWhile: limit of ${limit} steps reached`);
    }
    state = next(state);
    steps += 1;
  }
  return state;
}
