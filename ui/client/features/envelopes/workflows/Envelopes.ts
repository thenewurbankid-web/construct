// Pure (WORKFLOW-001): the state machine of one saved-flows read. Structurally identical to
// features/rules/workflows/Rules.ts.
import type { EnvelopesAction, EnvelopesState } from '../types';

export const initialEnvelopes: EnvelopesState = { status: 'idle', rows: [], error: null };

export function envelopesReducer(state: EnvelopesState, action: EnvelopesAction): EnvelopesState {
  switch (action.type) {
    case 'RUN':
      // Keep the previous result visible while re-running.
      return { ...state, status: 'running', error: null };
    case 'RESULT':
      return { status: 'ready', rows: action.rows, error: null };
    case 'FAIL':
      return { ...state, status: 'error', error: action.error };
    default:
      return state;
  }
}
