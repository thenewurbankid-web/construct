// Pure (WORKFLOW-001): what the Review screen knows about the ONE change being reviewed, and how each
// event changes it: waiting while the analysis runs, ready when it is done, failed with the engine's message.
import type { ChangeAction, ChangeViewState } from '../types.ts';

export const initialChange: ChangeViewState = { status: 'loading', data: null, error: null, selectedPath: null, grouping: 'feature' };

export function changeReducer(state: ChangeViewState, action: ChangeAction): ChangeViewState {
  switch (action.type) {
    case 'RESET':
      return { ...initialChange, grouping: state.grouping };
    case 'RESPONSE': {
      const d = action.data;
      if (d.state === 'done') return { ...state, status: 'ready', data: d, error: null };
      if (d.state === 'error') return { ...state, status: 'failed', data: d, error: d.error?.message ?? 'The analysis failed.' };
      return { ...state, status: 'waiting', data: d, error: null };
    }
    case 'FAILED':
      return { ...state, status: 'failed', error: action.error };
    case 'SELECT':
      return { ...state, selectedPath: action.path };
    case 'GROUPING':
      return { ...state, grouping: action.grouping };
    default:
      return state;
  }
}
