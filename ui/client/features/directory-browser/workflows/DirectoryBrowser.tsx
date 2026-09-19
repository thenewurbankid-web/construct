import type { DirListingView } from '../types';

// Pure reducer (WORKFLOW-001): the picker's flow state.
export type DirectoryBrowserState = {
  listing: DirListingView | null;
  loading: boolean;
  error: string | null;
  showHidden: boolean;
};

export type DirectoryBrowserAction =
  | { type: 'LOAD_START' }
  | { type: 'LOADED'; listing: DirListingView }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'SET_SHOW_HIDDEN'; value: boolean };

export const initialDirectoryBrowserState: DirectoryBrowserState = {
  listing: null,
  loading: false,
  error: null,
  showHidden: false,
};

export function directoryBrowserReducer(state: DirectoryBrowserState, action: DirectoryBrowserAction): DirectoryBrowserState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null };
    case 'LOADED':
      return { ...state, loading: false, error: null, listing: action.listing };
    case 'LOAD_ERROR':
      // Keep the last good listing visible so the user is not stranded.
      return { ...state, loading: false, error: action.error };
    case 'SET_SHOW_HIDDEN':
      return { ...state, showHidden: action.value };
    default:
      return state;
  }
}
