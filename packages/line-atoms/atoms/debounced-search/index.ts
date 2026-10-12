// Atom debounced-search (input.debounce): wait until the person stops typing before searching.
// The time comes in as events (TYPE and TICK carry `at`, in milliseconds), so the atom has no timer of its own: a page
// sends TICK from one setTimeout, a test sends it directly. The settled query is what a search box hands to
// TanStack Table's globalFilter or to react-router's search params.
import type { AtomMachine } from '../types.ts';

export interface DebounceState {
  status: 'idle' | 'waiting' | 'settled';
  text: string;
  query: string;
  dueAt: number | null;
  delay: number;
  minLength: number;
}

export type DebounceEvent =
  | { type: 'TYPE'; text: string; at: number }
  | { type: 'TICK'; at: number }
  | { type: 'FLUSH' }
  | { type: 'CLEAR' };

/** The query a text settles to: trimmed, and empty when shorter than the minimum length. */
export function settledQuery(text: string, minLength: number): string {
  const t = text.trim();
  if (t.length < minLength) {
    return '';
  }
  return t;
}

/** How long a page should wait before its next TICK, or null when nothing is waiting. */
export function waitFor(state: DebounceState, now: number): number | null {
  if (state.dueAt === null) {
    return null;
  }
  return Math.max(0, state.dueAt - now);
}

function settle(state: DebounceState): DebounceState {
  return { ...state, status: 'settled', query: settledQuery(state.text, state.minLength), dueAt: null };
}

export const machine: AtomMachine<DebounceState, DebounceEvent, { delay?: number; minLength?: number } | void> = {
  id: 'debounced-search',
  init(input) {
    return { status: 'idle', text: '', query: '', dueAt: null, delay: input?.delay ?? 300, minLength: input?.minLength ?? 0 };
  },
  send(state, event) {
    switch (event.type) {
      case 'TYPE':
        return { ...state, status: 'waiting', text: event.text, dueAt: event.at + state.delay };
      case 'TICK':
        if (state.status !== 'waiting' || state.dueAt === null || event.at < state.dueAt) {
          return state;
        }
        return settle(state);
      case 'FLUSH':
        if (state.status !== 'waiting') {
          return state;
        }
        return settle(state);
      case 'CLEAR':
        if (state.status === 'idle') {
          return state;
        }
        return machine.init({ delay: state.delay, minLength: state.minLength });
      default:
        return state;
    }
  },
  stateOf(state) {
    return state.status;
  },
};

/** The settled query after a list of timed keystrokes, checked at `now`: the shorthand a usecase or a test uses. */
export function debouncedSearch(typed: { text: string; at: number }[], now: number, options?: { delay?: number; minLength?: number }): string {
  let s = machine.init(options);
  for (const k of typed) {
    s = machine.send(s, { type: 'TICK', at: k.at });
    s = machine.send(s, { type: 'TYPE', text: k.text, at: k.at });
  }
  return machine.send(s, { type: 'TICK', at: now }).query;
}
