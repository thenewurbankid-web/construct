import type { ProjectStatus } from '../types';

// Workflows own application state/flow (README's non-negotiable defaults)
// but never import React (WORKFLOW-001) — this is a plain reducer, driven
// by the hook's useReducer, not a component.
export type ProjectGateState = {
  status: ProjectStatus | null;
  initializing: boolean;
  error: string | null;
  loadError: string | null;
  /** #365: opening a folder as the project (the "Open a project" screen). */
  opening: boolean;
  openError: string | null;
};

export type ProjectGateAction =
  | { type: 'STATUS_LOADED'; status: ProjectStatus }
  | { type: 'STATUS_FAILED'; message: string }
  | { type: 'STATUS_RETRY' }
  | { type: 'INIT_START' }
  | { type: 'INIT_SUCCESS'; status: ProjectStatus }
  | { type: 'INIT_ERROR'; error: string }
  | { type: 'OPEN_START' }
  | { type: 'OPEN_ERROR'; error: string };

export const initialProjectGateState: ProjectGateState = {
  status: null,
  initializing: false,
  error: null,
  loadError: null,
  opening: false,
  openError: null,
};

export function projectGateReducer(state: ProjectGateState, action: ProjectGateAction): ProjectGateState {
  switch (action.type) {
    case 'STATUS_LOADED':
      return { ...state, status: action.status, loadError: null };
    case 'STATUS_FAILED':
      return { ...state, loadError: action.message };
    case 'STATUS_RETRY':
      return { ...state, loadError: null };
    case 'INIT_START':
      return { ...state, initializing: true, error: null };
    case 'INIT_SUCCESS':
      return { ...state, initializing: false, status: action.status };
    case 'INIT_ERROR':
      return { ...state, initializing: false, error: action.error };
    case 'OPEN_START':
      return { ...state, opening: true, openError: null };
    case 'OPEN_ERROR':
      return { ...state, opening: false, openError: action.error };
    default:
      return state;
  }
}
