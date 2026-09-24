import type { CloneAuthMode, CloneJob } from '../types';

// Workflows own application state/flow but never import React (WORKFLOW-001): plain reducers.
export type CloneFormState = {
  /** Whatever was pasted into the one repository field. */
  input: string;
  /** A folder name typed by the person; '' = use the repository name. */
  name: string;
  /** A branch typed by the person; null = not edited (use the one read from the address, if any). */
  branch: string | null;
  /** The one-time access token (private repositories). Held only while the form is open; cleared once sent. */
  token: string;
  /** #638: how a private repository is authorised. Null = not chosen: the GitHub login when a connection exists, else the pasted token. */
  authChoice: CloneAuthMode | null;
  /** Sending the request. */
  starting: boolean;
  job: CloneJob | null;
  error: string | null;
};

export type CloneAction =
  | { type: 'SET_INPUT'; input: string }
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_BRANCH'; branch: string }
  | { type: 'SET_TOKEN'; token: string }
  | { type: 'SET_AUTH'; mode: CloneAuthMode }
  | { type: 'START' }
  | { type: 'STARTED'; job: CloneJob }
  | { type: 'REFUSED'; error: string }
  | { type: 'JOB'; job: CloneJob }
  | { type: 'DISMISS' };

export const initialCloneState: CloneFormState = { input: '', name: '', branch: null, token: '', authChoice: null, starting: false, job: null, error: null };

export function cloneReducer(state: CloneFormState, action: CloneAction): CloneFormState {
  switch (action.type) {
    case 'SET_INPUT':
      // A new address starts fresh: the branch read from the old one, and a previous failure, no longer apply.
      return { ...state, input: action.input, branch: null, error: null };
    case 'SET_NAME':
      return { ...state, name: action.name, error: null };
    case 'SET_BRANCH':
      return { ...state, branch: action.branch, error: null };
    case 'SET_TOKEN':
      return { ...state, token: action.token, error: null };
    case 'SET_AUTH':
      // Switching the way in drops what was typed for the other one: a token is never kept once it is not going to be used.
      return { ...state, authChoice: action.mode, token: action.mode === 'login' ? '' : state.token, error: null };
    case 'START':
      return { ...state, starting: true, error: null, job: null };
    case 'STARTED':
      // The token has been sent; the form does not keep it.
      return { ...state, starting: false, job: action.job, token: '' };
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
