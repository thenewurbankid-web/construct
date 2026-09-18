import type { PendingWorkflowEdit, WorkflowFileMachines, WorkflowsState } from '../types';

// Pure (WORKFLOW-001) — the workflows browser state machine: one feature ->
// one workflow file -> that file's extracted machines.
export type WorkflowsAction =
  | { type: 'FEATURES_LOADED'; features: string[] }
  | { type: 'SET_FEATURE'; feature: string }
  | { type: 'FILES_LOADED'; files: string[] }
  | { type: 'OPEN_FILE'; file: string }
  | { type: 'FILE_LOADED'; loaded: WorkflowFileMachines }
  | { type: 'FILE_ERROR'; error: string }
  | { type: 'EDIT_BUSY' }
  | { type: 'EDIT_PROPOSED'; pending: PendingWorkflowEdit }
  | { type: 'EDIT_ERROR'; error: string }
  | { type: 'EDIT_CANCELLED' };

export const initialWorkflowsState: WorkflowsState = {
  features: [],
  feature: '',
  files: [],
  filesLoading: false,
  file: '',
  loaded: null,
  error: null,
  pending: null,
  editBusy: false,
  editError: null,
};

export function workflowsReducer(state: WorkflowsState, action: WorkflowsAction): WorkflowsState {
  switch (action.type) {
    case 'FEATURES_LOADED':
      return { ...state, features: action.features };
    case 'SET_FEATURE':
      return { ...state, feature: action.feature, files: [], filesLoading: !!action.feature, file: '', loaded: null, error: null, pending: null, editError: null };
    case 'FILES_LOADED':
      return { ...state, files: action.files, filesLoading: false };
    case 'OPEN_FILE':
      return { ...state, file: action.file, loaded: null, error: null, pending: null, editError: null };
    case 'FILE_LOADED':
      return { ...state, loaded: action.loaded, error: null, pending: null, editBusy: false, editError: null };
    case 'FILE_ERROR':
      return { ...state, loaded: null, error: action.error };
    case 'EDIT_BUSY':
      return { ...state, editBusy: true, editError: null };
    case 'EDIT_PROPOSED':
      return { ...state, editBusy: false, pending: action.pending, editError: null };
    case 'EDIT_ERROR':
      return { ...state, editBusy: false, editError: action.error, pending: null };
    case 'EDIT_CANCELLED':
      return { ...state, pending: null, editError: null };
    default:
      return state;
  }
}
