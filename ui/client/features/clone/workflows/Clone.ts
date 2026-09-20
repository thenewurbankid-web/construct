import type { CloneJob } from '../types';

// Workflows own application state/flow but never import React (WORKFLOW-001): plain reducers.
export type CloneFormState = {
  url: string;
  name: string;
  /** Sending the request. */
  starting: boolean;
  job: CloneJob | null;
  error: string | null;
};

export type CloneAction =
  | { type: 'SET_URL'; url: string }
  | { type: 'SET_NAME'; name: string }
  | { type: 'START' }
  | { type: 'STARTED'; job: CloneJob }
  | { type: 'REFUSED'; error: string }
  | { type: 'JOB'; job: CloneJob }
  | { type: 'DISMISS' };

export const initialCloneState: CloneFormState = { url: '', name: '', starting: false, job: null, error: null };

export function cloneReducer(state: CloneFormState, action: CloneAction): CloneFormState {
  switch (action.type) {
    case 'SET_URL':
      return { ...state, url: action.url, error: null };
    case 'SET_NAME':
      return { ...state, name: action.name, error: null };
    case 'START':
      return { ...state, starting: true, error: null, job: null };
    case 'STARTED':
      return { ...state, starting: false, job: action.job };
    case 'REFUSED':
      return { ...state, starting: false, error: action.error };
    case 'JOB':
      return state.job && state.job.id === action.job.id ? { ...state, job: action.job } : state;
    case 'DISMISS':
      return { ...state, job: null, error: null };
    default:
      return state;
  }
}
