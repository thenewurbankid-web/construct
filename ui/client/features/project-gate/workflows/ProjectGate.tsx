import type { ProjectStatus } from '../types';

// Workflows own application state/flow (README's non-negotiable defaults)
// but never import React (WORKFLOW-001) — this is a plain reducer, driven
// by the hook's useReducer, not a component.
export type ProjectGateState = {
  status: ProjectStatus | null;
  initializing: boolean;
  error: string | null;
};

export type ProjectGateAction =
  | { type: 'STATUS_LOADED'; status: ProjectStatus }
  | { type: 'INIT_START' }
  | { type: 'INIT_SUCCESS'; status: ProjectStatus }
  | { type: 'INIT_ERROR'; error: string };

export const initialProjectGateState: ProjectGateState = {
  status: null,
  initializing: false,
  error: null,
};

export function projectGateReducer(state: ProjectGateState, action: ProjectGateAction): ProjectGateState {
  switch (action.type) {
    case 'STATUS_LOADED':
      return { ...state, status: action.status };
    case 'INIT_START':
      return { ...state, initializing: true, error: null };
    case 'INIT_SUCCESS':
      return { ...state, initializing: false, status: action.status };
    case 'INIT_ERROR':
      return { ...state, initializing: false, error: action.error };
    default:
      return state;
  }
}
