// Pure (WORKFLOW-001): the state machine of one rules read.
import type { RulesAction, RulesState } from '../types';

export const initialRules: RulesState = { status: 'idle', rows: [], error: null };

export function rulesReducer(state: RulesState, action: RulesAction): RulesState {
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
