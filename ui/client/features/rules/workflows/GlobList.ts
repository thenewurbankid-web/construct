// Pure (WORKFLOW-001): #395 slice D -- the state machine of a glob list (nonLayer/frozen), and of one add/remove
// edit against it. Structurally identical to workflows/Exceptions.ts's pair, generalized to a flat string list.
import type { GlobEditAction, GlobEditState, GlobListAction, GlobListState } from '../types';

export const initialGlobList: GlobListState = { status: 'idle', rows: [], error: null };

export function globListReducer(state: GlobListState, action: GlobListAction): GlobListState {
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

export function globEditReducer(state: GlobEditState, action: GlobEditAction): GlobEditState {
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
