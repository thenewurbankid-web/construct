// Atom polling (query.poll): load data again on a timer until it is done.
// Wraps TanStack Query's refetchInterval, enabled and retry: a fixed interval between good answers, a doubling back-off
// after failures (capped), a stop when the answer says the work is done, and a give-up after too many failures in a
// row. The atom keeps no timer: it says how long to wait (nextDelay) and the page sends TICK when that time is up.
import type { AtomMachine } from '../types.ts';

export interface PollState<D> {
  status: 'stopped' | 'fetching' | 'waiting' | 'backoff' | 'finished';
  data: D | null;
  error: unknown;
  failures: number;
  attempts: number;
  nextDelay: number | null;
  interval: number;
  maxBackoff: number;
  maxFailures: number;
  isDone: (data: D) => boolean;
}

export type PollEvent<D> =
  | { type: 'START' }
  | { type: 'STOP' }
  | { type: 'TICK' }
  | { type: 'RESOLVE'; data: D }
  | { type: 'REJECT'; error: unknown };

export interface PollInput<D> { interval: number; maxBackoff?: number; maxFailures?: number; isDone?: (data: D) => boolean }

/** The wait after `failures` failures in a row: interval x 2^(failures - 1), capped at maxBackoff. */
export function backoffDelay(interval: number, failures: number, maxBackoff: number): number {
  return Math.min(maxBackoff, interval * 2 ** Math.max(0, failures - 1));
}

export const machine: AtomMachine<PollState<any>, PollEvent<any>, PollInput<any>> = {
  id: 'polling',
  init(input) {
    return {
      status: 'stopped', data: null, error: null, failures: 0, attempts: 0, nextDelay: null,
      interval: input.interval, maxBackoff: input.maxBackoff ?? input.interval * 8, maxFailures: input.maxFailures ?? 5, isDone: input.isDone ?? (() => false),
    };
  },
  send(state, event) {
    switch (event.type) {
      case 'START':
        if (state.status !== 'stopped' && state.status !== 'finished') {
          return state;
        }
        return { ...state, status: 'fetching', failures: 0, error: null, nextDelay: null, attempts: state.attempts + 1 };
      case 'STOP':
        if (state.status === 'stopped') {
          return state;
        }
        return { ...state, status: 'stopped', nextDelay: null };
      case 'TICK':
        if (state.status !== 'waiting' && state.status !== 'backoff') {
          return state;
        }
        return { ...state, status: 'fetching', nextDelay: null, attempts: state.attempts + 1 };
      case 'RESOLVE':
        if (state.status !== 'fetching') {
          return state;
        }
        if (state.isDone(event.data)) {
          return { ...state, status: 'finished', data: event.data, failures: 0, error: null, nextDelay: null };
        }
        return { ...state, status: 'waiting', data: event.data, failures: 0, error: null, nextDelay: state.interval };
      case 'REJECT': {
        if (state.status !== 'fetching') {
          return state;
        }
        const failures = state.failures + 1;
        if (failures >= state.maxFailures) {
          return { ...state, status: 'stopped', error: event.error, failures, nextDelay: null };
        }
        return { ...state, status: 'backoff', error: event.error, failures, nextDelay: backoffDelay(state.interval, failures, state.maxBackoff) };
      }
      default:
        return state;
    }
  },
  stateOf(state) {
    return state.status;
  },
};

/** The status of a poll after a list of answers (true: good data, false: a failure): the shorthand a test or a usecase uses. */
export function polling<D>(input: PollInput<D>, answers: ({ data: D } | { error: unknown })[]): PollState<D> {
  let s = machine.send(machine.init(input), { type: 'START' }) as PollState<D>;
  for (const a of answers) {
    if ('data' in a) {
      s = machine.send(s, { type: 'RESOLVE', data: a.data }) as PollState<D>;
    } else {
      s = machine.send(s, { type: 'REJECT', error: a.error }) as PollState<D>;
    }
    s = machine.send(s, { type: 'TICK' }) as PollState<D>;
  }
  return s;
}
