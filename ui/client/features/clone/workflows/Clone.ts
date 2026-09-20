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

export type RemoteFormState = {
  url: string;
  busy: boolean;
  loaded: boolean;
  repo: boolean;
  connected: boolean;
  current: string | null;
  error: string | null;
};

export type RemoteAction =
  | { type: 'LOADED'; repo: boolean; connected: boolean; url: string | null }
  | { type: 'SET_URL'; url: string }
  | { type: 'BUSY' }
  | { type: 'FAILED'; error: string };

export const initialRemoteState: RemoteFormState = { url: '', busy: false, loaded: false, repo: false, connected: false, current: null, error: null };

export function remoteReducer(state: RemoteFormState, action: RemoteAction): RemoteFormState {
  switch (action.type) {
    case 'LOADED':
      return { ...state, loaded: true, busy: false, error: null, repo: action.repo, connected: action.connected, current: action.url };
    case 'SET_URL':
      return { ...state, url: action.url, error: null };
    case 'BUSY':
      return { ...state, busy: true, error: null };
    case 'FAILED':
      return { ...state, busy: false, loaded: true, error: action.error };
    default:
      return state;
  }
}
