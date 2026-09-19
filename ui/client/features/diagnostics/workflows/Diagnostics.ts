// Pure (WORKFLOW-001): the state machine of one validate run.
import type { DiagnosticsAction, DiagnosticsState } from '../types.ts';

export const initialDiagnostics: DiagnosticsState = {
  status: 'idle',
  violations: [],
  total: 0,
  truncated: false,
  durationMs: null,
  error: null,
};

export function diagnosticsReducer(state: DiagnosticsState, action: DiagnosticsAction): DiagnosticsState {
  switch (action.type) {
    case 'RUN':
      // Keep the previous result visible while re-running.
      return { ...state, status: 'running', error: null };
    case 'RESULT':
      return { status: 'ready', violations: action.violations, total: action.total, truncated: action.truncated, durationMs: action.durationMs, error: null };
    case 'FAIL':
      return { ...state, status: 'error', error: action.error };
    default:
      return state;
  }
}
