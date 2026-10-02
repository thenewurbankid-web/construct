// Pure (WORKFLOW-001): the state machine of switching to a named preset (#395 slice 6). Same shape
// as ruleEditReducer, keyed by preset name instead of a rule id; the stale-result guard lives in the
// hook, not here.
import type { PresetEditAction, PresetEditState } from '../types';

export function presetEditReducer(state: PresetEditState, action: PresetEditAction): PresetEditState {
  switch (action.type) {
    case 'START':
      return { preset: action.preset, status: 'previewing', before: '', after: '', contentHash: '', changes: [], error: null };
    case 'PREVIEW_OK':
      return state ? { ...state, status: 'ready', before: action.before, after: action.after, contentHash: action.contentHash, changes: action.changes } : state;
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
