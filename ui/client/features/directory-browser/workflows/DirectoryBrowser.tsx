import type { DirListingView } from '../types';

// Pure reducer (WORKFLOW-001): the project list's flow state (#664). One status at a time. The last good
// listing rides along on `loading` and `error` (a "Load more" that is in flight or failed must not strand
// the user with an empty list); before the first answer there is none, so it is null there.
export type DirectoryBrowserState =
  | { status: 'idle' }
  | { status: 'loading'; listing: DirListingView | null }
  | { status: 'error'; error: string; listing: DirListingView | null }
  | { status: 'ready'; listing: DirListingView };

export type DirectoryBrowserAction =
  | { type: 'LOAD_START' }
  | { type: 'LOADED'; listing: DirListingView }
  | { type: 'LOAD_ERROR'; error: string };

export const initialDirectoryBrowserState: DirectoryBrowserState = { status: 'idle' };

/** The listing to show: the current one, or the last good one while loading or after a failure. */
export const directoryListing = (state: DirectoryBrowserState): DirListingView | null =>
  state.status === 'idle' ? null : state.listing;

/** True while a read is in flight. */
export const directoryIsLoading = (state: DirectoryBrowserState): boolean => state.status === 'loading';

/** The failure of the last read; null when there is none. */
export const directoryError = (state: DirectoryBrowserState): string | null => (state.status === 'error' ? state.error : null);

export function directoryBrowserReducer(state: DirectoryBrowserState, action: DirectoryBrowserAction): DirectoryBrowserState {
  switch (action.type) {
    case 'LOAD_START':
      return { status: 'loading', listing: directoryListing(state) };
    case 'LOADED':
      return { status: 'ready', listing: action.listing };
    case 'LOAD_ERROR':
      // Keep the last good listing visible so the user is not stranded.
      return { status: 'error', error: action.error, listing: directoryListing(state) };
    default:
      return state;
  }
}
