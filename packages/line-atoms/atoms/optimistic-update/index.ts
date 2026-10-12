// Atom optimistic-update (data.optimistic): show a change at once, and put the old value back if saving fails.
// Wraps TanStack Query's optimistic mutation: onMutate takes a snapshot and writes the new value, onError rolls back
// to the snapshot, onSettled confirms with what the server answered.
import type { AtomMachine } from '../types.ts';

export interface OptimisticState<V> {
  status: 'idle' | 'applied' | 'committed' | 'rolledBack';
  value: V;
  snapshot: V | null;
  error: unknown;
}

export type OptimisticEvent<V> =
  | { type: 'APPLY'; update: (value: V) => V }
  | { type: 'COMMIT'; value?: V }
  | { type: 'ROLLBACK'; error: unknown };

export const machine: AtomMachine<OptimisticState<any>, OptimisticEvent<any>, { value: any }> = {
  id: 'optimistic-update',
  init(input) {
    return { status: 'idle', value: input.value, snapshot: null, error: null };
  },
  send(state, event) {
    switch (event.type) {
      case 'APPLY':
        // A change on top of one still saving keeps the first snapshot: a rollback goes back to the last saved value.
        if (state.status === 'applied') {
          return { ...state, value: event.update(state.value) };
        }
        return { status: 'applied', value: event.update(state.value), snapshot: state.value, error: null };
      case 'COMMIT':
        if (state.status !== 'applied') {
          return state;
        }
        if (event.value === undefined) {
          return { status: 'committed', value: state.value, snapshot: null, error: null };
        }
        return { status: 'committed', value: event.value, snapshot: null, error: null };
      case 'ROLLBACK':
        if (state.status !== 'applied') {
          return state;
        }
        return { status: 'rolledBack', value: state.snapshot, snapshot: null, error: event.error };
      default:
        return state;
    }
  },
  stateOf(state) {
    return state.status;
  },
};

/**
 * Apply `update` at once, then save it with `write`: committed with what `write` answers, or rolled back to the old
 * value when it throws.
 */
export async function optimisticUpdate<V>(state: OptimisticState<V>, update: (value: V) => V, write: (value: V) => Promise<V | void>): Promise<OptimisticState<V>> {
  const applied = machine.send(state, { type: 'APPLY', update }) as OptimisticState<V>;
  try {
    const saved = await write(applied.value);
    if (saved === undefined) {
      return machine.send(applied, { type: 'COMMIT' }) as OptimisticState<V>;
    }
    return machine.send(applied, { type: 'COMMIT', value: saved }) as OptimisticState<V>;
  } catch (error) {
    return machine.send(applied, { type: 'ROLLBACK', error }) as OptimisticState<V>;
  }
}
