// Atom undo-history (state.undo): undo and redo changes to a value.
// Wraps the zustand temporal pattern (pastStates, futureStates, undo, redo, a history limit): a new value clears what
// could be redone, the oldest past value is dropped past the limit, and setting the same value again records nothing.
import type { AtomMachine } from '../types.ts';

export interface HistoryState<V> {
  status: 'clean' | 'undoable' | 'redoable' | 'both';
  past: V[];
  present: V;
  future: V[];
  limit: number;
}

export type HistoryEvent<V> =
  | { type: 'SET'; value: V }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'CLEAR' };

function statusOf(past: unknown[], future: unknown[]): HistoryState<unknown>['status'] {
  if (past.length > 0 && future.length > 0) {
    return 'both';
  }
  if (past.length > 0) {
    return 'undoable';
  }
  if (future.length > 0) {
    return 'redoable';
  }
  return 'clean';
}

function history<V>(past: V[], present: V, future: V[], limit: number): HistoryState<V> {
  return { status: statusOf(past, future), past, present, future, limit };
}

export function canUndo(state: HistoryState<unknown>): boolean {
  return state.past.length > 0;
}

export function canRedo(state: HistoryState<unknown>): boolean {
  return state.future.length > 0;
}

export const machine: AtomMachine<HistoryState<any>, HistoryEvent<any>, { value: any; limit?: number }> = {
  id: 'undo-history',
  init(input) {
    return history([], input.value, [], input.limit ?? 100);
  },
  send(state, event) {
    switch (event.type) {
      case 'SET': {
        if (Object.is(event.value, state.present)) {
          return state;
        }
        const past = [...state.past, state.present].slice(-state.limit);
        return history(past, event.value, [], state.limit);
      }
      case 'UNDO': {
        if (!canUndo(state)) {
          return state;
        }
        const previous = state.past[state.past.length - 1];
        return history(state.past.slice(0, -1), previous, [state.present, ...state.future], state.limit);
      }
      case 'REDO': {
        if (!canRedo(state)) {
          return state;
        }
        const [next, ...rest] = state.future;
        return history([...state.past, state.present], next, rest, state.limit);
      }
      case 'CLEAR':
        if (state.status === 'clean') {
          return state;
        }
        return history([], state.present, [], state.limit);
      default:
        return state;
    }
  },
  stateOf(state) {
    return state.status;
  },
};

/** The value after a list of edits, undos and redos: the shorthand a usecase or a test uses. */
export function undoHistory<V>(value: V, events: HistoryEvent<V>[], limit?: number): HistoryState<V> {
  return events.reduce((s, e) => machine.send(s, e), machine.init({ value, limit })) as HistoryState<V>;
}
