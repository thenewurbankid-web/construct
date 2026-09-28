// Pure (WORKFLOW-001): #395 slice C -- the state machine of the exceptions list, and of one add/remove edit.
import type { ExceptionEditAction, ExceptionEditState, ExceptionsAction, ExceptionsState } from '../types';

export const initialExceptions: ExceptionsState = { status: 'idle', rows: [], error: null };

export function exceptionsReducer(state: ExceptionsState, action: ExceptionsAction): ExceptionsState {
  switch (action.type) {
    case 'RUN':
      return { ...state, status: 'running', error: null };
    case 'RESULT':
      return { status: 'ready', rows: action.rows, error: null };
    case 'FAIL':
      return { ...state, status: 'error', error: action.error };
    default:
      return state;
  }
}

export function exceptionEditReducer(state: ExceptionEditState, action: ExceptionEditAction): ExceptionEditState {
  switch (action.type) {
    case 'START':
      return { kind: action.kind, status: 'previewing', before: '', after: '', contentHash: '', error: null };
    case 'PREVIEW_OK':
      return state ? { ...state, status: 'ready', before: action.before, after: action.after, contentHash: action.contentHash } : state;
    case 'PREVIEW_FAIL':
      return state ? { ...state, status: 'error', error: action.error } : state;
    case 'SAVE':
      return state ? { ...state, status: 'saving', error: null } : state;
    case 'SAVE_FAIL':
      return state ? { ...state, status: 'error', error: action.error } : state;
    case 'CANCEL':
      return null;
    default:
      return state;
  }
}
