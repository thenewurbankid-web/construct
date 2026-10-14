// Loop atoms: forEach and a bounded while. There is no unbounded loop atom.

/** What repeatWhile reports: how many steps ran and whether the limit cut the loop short. */
export interface RepeatOutcome {
  readonly steps: number;
  readonly stoppedByLimit: boolean;
}

function checkLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError(`loop limit must be a whole number >= 0, got ${String(limit)}`);
  }
}

/**
 * each(list, (item, index) => effect) reads "for each item of list, effect".
 * Exactly `list.forEach(fn)`; exists only for the callback's effects (it returns undefined).
 */
export function each<T>(list: readonly T[], fn: (item: T, index: number, list: readonly T[]) => void): void {
  list.forEach(fn);
}

/**
 * repeatWhile(() => condition, () => step, limit) reads "repeat step while condition, at most limit times".
 * Exactly `while (condition) { step }`, except it never runs step more than limit times
 * (limit must be a finite whole number). The outcome says whether the limit stopped it.
 */
export function repeatWhile(condition: () => unknown, step: () => void, limit: number): RepeatOutcome {
  checkLimit(limit);
  let steps = 0;
  while (condition()) {
    if (steps >= limit) {
      return { steps, stoppedByLimit: true };
    }
    step();
    steps += 1;
  }
  return { steps, stoppedByLimit: false };
}

/**
 * iterateWhile(start, (s) => condition, (s) => next, limit) reads "starting from start, step to next while condition, at most limit times".
 * The pure form of repeatWhile: threads a state value instead of mutating variables, and
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
