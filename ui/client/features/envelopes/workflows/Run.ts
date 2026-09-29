// Pure (WORKFLOW-001): #395/#772's "Run this flow" -- idle/loading/started/error, same shape as Plan mode's
// own run state (ui/client/features/plan/domain/PlanTypes.ts's `runStatus`).
import type { RunAction, RunState } from '../types';

export const initialRun: RunState = { status: 'idle', processId: null, models: [], error: null };

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'LOADING':
      return { ...state, status: 'loading', error: null };
    case 'STARTED':
      return { status: 'started', processId: action.processId, models: action.models, error: null };
    case 'FAILED':
      return { ...state, status: 'error', error: action.error };
    case 'RESET':
      return initialRun;
    default:
      return state;
  }
}
