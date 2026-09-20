// Pure (WORKFLOW-001): what the Review screen knows about the ONE change being reviewed, and how each
// event changes it: waiting while the analysis runs, ready when it is done, failed with the engine's message.
import type { ChangeAction, ChangeViewState } from '../types.ts';

export const initialChange: ChangeViewState = { status: 'loading', data: null, error: null, errorCode: null, selectedPath: null, selectedFindingId: null, grouping: 'feature' };

export function changeReducer(state: ChangeViewState, action: ChangeAction): ChangeViewState {
  switch (action.type) {
    case 'RESET':
      return { ...initialChange, grouping: state.grouping };
    case 'RESPONSE': {
      const d = action.data;
      if (d.state === 'done') return { ...state, status: 'ready', data: d, error: null, errorCode: null };
      if (d.state === 'error') return { ...state, status: 'failed', data: d, error: d.error?.message ?? 'The analysis failed.', errorCode: d.error?.code ?? null };
      // A cancelled analysis (from the Processes drawer or from here) is a stop the person asked for, not a failure:
      // it says so and offers to run it again; it never restarts by itself.
      if (d.state === 'cancelled') return { ...state, status: 'failed', data: d, error: 'The analysis was cancelled.', errorCode: 'CANCELLED' };
      return { ...state, status: 'waiting', data: d, error: null, errorCode: null };
    }
    case 'FAILED':
      return { ...state, status: 'failed', error: action.error, errorCode: action.code ?? null };
    case 'SELECT':
      return { ...state, selectedPath: action.path };
    case 'SELECT_FINDING':
      return { ...state, selectedFindingId: action.id };
    case 'GROUPING':
      return { ...state, grouping: action.grouping };
    default:
      return state;
  }
}
