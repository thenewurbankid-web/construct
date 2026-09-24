// Pure (WORKFLOW-001): what the Review branch list knows, and how each event changes it (#592). One status
// at a time: a failed read carries no rows, so nothing downstream can mistake a dead poll for a live one.
// The ranking order is independent of loading, so it lives beside this machine (useReviewList), not in it.
import type { BranchList, ListAction, ListState } from '../types.ts';

export const initialList: ListState = { status: 'idle' };

export function listReducer(state: ListState, action: ListAction): ListState {
  switch (action.type) {
    case 'STARTED':
      // A re-read of a list already on screen keeps showing it; only idle or failed goes back to loading.
      return state.status === 'idle' || state.status === 'error' ? { status: 'loading' } : state;
    case 'LOADED':
      return { status: 'ready', data: action.data };
    case 'FAILED':
      return { status: 'error', error: action.error, errorCode: action.code ?? null };
    default:
      return state;
  }
}

/** The rows, once read; null while idle, loading or failed. */
export const listData = (state: ListState): BranchList | null => (state.status === 'ready' ? state.data : null);

/** True while any row is still being analysed (the list keeps polling until this is false). Never true for a list that is not ready. */
export const listIsSettling = (state: ListState): boolean =>
  state.status === 'ready' &&
  state.data.branches.some((b) => b.analysis.state === 'none' || b.analysis.state === 'queued' || b.analysis.state === 'running' || b.analysis.state === 'paused');
