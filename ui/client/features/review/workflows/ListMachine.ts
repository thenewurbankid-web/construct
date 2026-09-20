// Pure (WORKFLOW-001): what the Review branch list knows, and how each event changes it.
import type { ListAction, ListState } from '../types.ts';

export const initialList: ListState = { loaded: false, error: null, errorCode: null, data: null, order: 'risk' };

export function listReducer(state: ListState, action: ListAction): ListState {
  switch (action.type) {
    case 'LOADED':
      return { ...state, loaded: true, error: null, errorCode: null, data: action.data };
    case 'FAILED':
      return { ...state, loaded: true, error: action.error, errorCode: action.code ?? null };
    case 'ORDER':
      return { ...state, order: action.order };
    default:
      return state;
  }
}

/** True while any row is still being analysed (the list keeps polling until this is false). */
export const listIsSettling = (state: ListState): boolean =>
  !!state.data?.branches.some((b) => b.analysis.state === 'none' || b.analysis.state === 'queued' || b.analysis.state === 'running' || b.analysis.state === 'paused');
