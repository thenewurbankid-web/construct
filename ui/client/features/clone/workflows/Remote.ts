// Workflows own application state/flow but never import React (WORKFLOW-001): a plain reducer.
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
