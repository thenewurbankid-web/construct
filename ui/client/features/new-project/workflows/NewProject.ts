import type { NewProjectFormState } from '../types';

// Workflows own application state/flow but never import React (WORKFLOW-001): a plain reducer.
export type NewProjectAction =
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_FRAMEWORK'; framework: NewProjectFormState['framework'] }
  | { type: 'START' }
  | { type: 'REFUSED'; error: string };

export const initialNewProjectState: NewProjectFormState = { name: '', framework: 'nextjs', creating: false, error: null };

export function newProjectReducer(state: NewProjectFormState, action: NewProjectAction): NewProjectFormState {
  switch (action.type) {
    case 'SET_NAME':
      // A new name starts fresh: a refusal of the old one no longer applies.
      return { ...state, name: action.name, error: null };
    case 'SET_FRAMEWORK':
      return { ...state, framework: action.framework, error: null };
    case 'START':
      return { ...state, creating: true, error: null };
    case 'REFUSED':
      return { ...state, creating: false, error: action.error };
    default:
      return state;
  }
}
