// Pure (WORKFLOW-001): the state machine of one rule's severity edit (#395 slice B). A stale async
// result (PREVIEW_OK/PREVIEW_FAIL for a rule that is no longer the one being edited, because the
// user cancelled or started editing a different row) is dropped by the hook before it reaches here,
// so this reducer never has to compare ruleId itself except to keep it in the new state.
import type { RuleEditAction, RuleEditState } from '../types';

export function ruleEditReducer(state: RuleEditState, action: RuleEditAction): RuleEditState {
  switch (action.type) {
    case 'START':
      return { ruleId: action.ruleId, severity: action.severity, status: 'previewing', before: '', after: '', contentHash: '', error: null };
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
