import type { WorkflowFileMachines, WorkflowsState } from '../types';

// Pure (WORKFLOW-001) — the workflows browser state machine: one feature ->
// one workflow file -> that file's extracted machines.
export type WorkflowsAction =
  | { type: 'FEATURES_LOADED'; features: string[] }
  | { type: 'SET_FEATURE'; feature: string }
  | { type: 'FILES_LOADED'; files: string[] }
  | { type: 'OPEN_FILE'; file: string }
  | { type: 'FILE_LOADED'; loaded: WorkflowFileMachines }
  | { type: 'FILE_ERROR'; error: string };

export const initialWorkflowsState: WorkflowsState = {
  features: [],
  feature: '',
  files: [],
  filesLoading: false,
  file: '',
  loaded: null,
  error: null,
};

export function workflowsReducer(state: WorkflowsState, action: WorkflowsAction): WorkflowsState {
  switch (action.type) {
    case 'FEATURES_LOADED':
      return { ...state, features: action.features };
    case 'SET_FEATURE':
      return { ...state, feature: action.feature, files: [], filesLoading: !!action.feature, file: '', loaded: null, error: null };
    case 'FILES_LOADED':
      return { ...state, files: action.files, filesLoading: false };
    case 'OPEN_FILE':
      return { ...state, file: action.file, loaded: null, error: null };
    case 'FILE_LOADED':
      return { ...state, loaded: action.loaded, error: null };
    case 'FILE_ERROR':
      return { ...state, loaded: null, error: action.error };
    default:
      return state;
  }
}
