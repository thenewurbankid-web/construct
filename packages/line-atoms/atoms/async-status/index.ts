// Atom async-status (query.loading): load data and track whether it is idle, pending, loaded or failed.
// Wraps TanStack Query's status (pending | error | success) and fetchStatus (fetching | idle): a refetch keeps the
// loaded data and only sets `fetching`. Every FETCH gets a request number, and an answer to an older request is
// ignored, so a slow first response can never overwrite a newer one.
import type { AtomMachine } from '../types.ts';

export type AsyncStatus = 'idle' | 'pending' | 'success' | 'error';

export interface AsyncState<D> {
  status: AsyncStatus;
  data: D | null;
  error: unknown;
  fetching: boolean;
  request: number;
  updatedAt: number | null;
}

export type AsyncEvent<D> =
  | { type: 'FETCH' }
  | { type: 'RESOLVE'; data: D; request?: number; at?: number }
  | { type: 'REJECT'; error: unknown; request?: number }
  | { type: 'RESET' };

/** Whether an answer belongs to the request in flight (an answer without a number is taken as current). */
export function isCurrent(state: AsyncState<unknown>, request: number | undefined): boolean {
  if (!state.fetching) {
    return false;
  }
  if (request === undefined) {
    return true;
  }
  return request === state.request;
}

export const machine: AtomMachine<AsyncState<any>, AsyncEvent<any>, void> = {
  id: 'async-status',
  init() {
    return { status: 'idle', data: null, error: null, fetching: false, request: 0, updatedAt: null };
  },
  send(state, event) {
    switch (event.type) {
      case 'FETCH': {
        if (state.status === 'success') {
          return { ...state, fetching: true, request: state.request + 1 };
        }
        return { ...state, status: 'pending', error: null, fetching: true, request: state.request + 1 };
      }
      case 'RESOLVE':
        if (!isCurrent(state, event.request)) {
          return state;
        }
        return { ...state, status: 'success', data: event.data, error: null, fetching: false, updatedAt: event.at ?? null };
      case 'REJECT':
        if (!isCurrent(state, event.request)) {
          return state;
        }
        return { ...state, status: 'error', error: event.error, fetching: false };
      case 'RESET':
        return machine.init();
      default:
        return state;
    }
  },
  stateOf(state) {
    return state.status;
  },
};

/** Run one load through the machine: FETCH, then RESOLVE or REJECT with the load's answer. */
export async function loadAsync<D>(state: AsyncState<D>, load: () => Promise<D>, now: () => number = () => Date.now()): Promise<AsyncState<D>> {
  const started = machine.send(state, { type: 'FETCH' }) as AsyncState<D>;
  try {
    const data = await load();
    return machine.send(started, { type: 'RESOLVE', data, request: started.request, at: now() }) as AsyncState<D>;
  } catch (error) {
    return machine.send(started, { type: 'REJECT', error, request: started.request }) as AsyncState<D>;
  }
}

/** The four flags a page usually renders from. */
export function flags(state: AsyncState<unknown>): { isLoading: boolean; isError: boolean; isSuccess: boolean; isRefetching: boolean } {
  return {
    isLoading: state.status === 'pending',
    isError: state.status === 'error',
    isSuccess: state.status === 'success',
    isRefetching: state.status === 'success' && state.fetching,
  };
}
