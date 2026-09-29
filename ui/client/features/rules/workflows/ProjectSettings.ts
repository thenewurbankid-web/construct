// Pure (WORKFLOW-001): #395 slice 5 -- the state machine of the project.framework/features.root read, and of one
// pending single-field edit against it. Structurally identical to workflows/RuleEdit.ts, generalized to a `field`
// discriminator instead of a rule id.
import type { ProjectEditAction, ProjectEditState, ProjectSettingsAction, ProjectSettingsState } from '../types';

export const initialProjectSettings: ProjectSettingsState = { status: 'idle', value: null, error: null };

export function projectSettingsReducer(state: ProjectSettingsState, action: ProjectSettingsAction): ProjectSettingsState {
  switch (action.type) {
    case 'RUN':
      return { ...state, status: 'running', error: null };
    case 'RESULT':
      return { status: 'ready', value: action.value, error: null };
    case 'FAIL':
      return { ...state, status: 'error', error: action.error };
    default:
      return state;
  }
}

export function projectEditReducer(state: ProjectEditState, action: ProjectEditAction): ProjectEditState {
  switch (action.type) {
    case 'START':
      return { field: action.field, value: action.value, status: 'previewing', before: '', after: '', contentHash: '', error: null };
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
