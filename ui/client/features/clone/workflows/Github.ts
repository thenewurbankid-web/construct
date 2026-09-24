import type { GithubRepo, GithubRepoList, GithubStatus } from '../types.ts';
import { mergeRepoPages } from '../domain/GithubRepoPages.ts';

// Workflows own application state/flow but never import React (WORKFLOW-001): plain reducers.
/** The GitHub connection for private repositories (#638): its status and the repositories it can read. The token is not here (nor anywhere in the browser). */
export type GithubState = {
  /** Null until the first answer (or when it failed): the feature shows nothing until it is known to be on. */
  status: GithubStatus | null;
  busy: boolean;
  error: string | null;
  repos: GithubRepo[];
  list: GithubRepoList | null;
  /** The filter typed above the picker (asked of the server, which searches all pages). */
  query: string;
  reposLoading: boolean;
  reposError: string | null;
};

export type GithubAction =
  | { type: 'STATUS'; status: GithubStatus }
  | { type: 'STATUS_FAILED' }
  | { type: 'BUSY' }
  | { type: 'ERROR'; error: string }
  | { type: 'SET_QUERY'; query: string }
  | { type: 'REPOS_LOADING' }
  | { type: 'REPOS'; list: GithubRepoList }
  | { type: 'REPOS_FAILED'; error: string };

export const initialGithubState: GithubState = { status: null, busy: false, error: null, repos: [], list: null, query: '', reposLoading: false, reposError: null };

export function githubReducer(state: GithubState, action: GithubAction): GithubState {
  switch (action.type) {
    case 'STATUS':
      // Not connected (any more): whatever was listed goes with the connection.
      return action.status.connected ? { ...state, status: action.status, busy: false, error: null } : { ...initialGithubState, status: action.status };
    case 'STATUS_FAILED':
      return { ...state, busy: false };
    case 'BUSY':
      return { ...state, busy: true, error: null };
    case 'ERROR':
      return { ...state, busy: false, error: action.error };
    case 'SET_QUERY':
      return { ...state, query: action.query };
    case 'REPOS_LOADING':
      return { ...state, reposLoading: true, reposError: null };
    case 'REPOS':
      return { ...state, reposLoading: false, reposError: null, list: action.list, repos: mergeRepoPages(state.repos, action.list) };
    case 'REPOS_FAILED':
      return { ...state, reposLoading: false, reposError: action.error };
    default:
      return state;
  }
}
