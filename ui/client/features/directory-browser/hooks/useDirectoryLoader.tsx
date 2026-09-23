'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { toListingView } from '../domain/DirectoryListing';
import { browseDirectory } from '../services/DirectoryBrowser';
import { directoryBrowserReducer, initialDirectoryBrowserState } from '../workflows/DirectoryBrowser';

/** Owns the list's state and the load primitive. The server only ever lists the signed-in user's own
 * workspace, one level, so there is no path to load from. */
export function useDirectoryLoader() {
  const [state, dispatch] = useReducer(directoryBrowserReducer, initialDirectoryBrowserState);

  const load = useCallback(async (offset?: number) => {
    dispatch({ type: 'LOAD_START' });
    const raw = await browseDirectory({ offset });
    if (!raw.ok) {
      dispatch({ type: 'LOAD_ERROR', error: raw.error });
      return null;
    }
    return toListingView(raw);
  }, []);

  useEffect(() => {
    load().then((listing) => {
      if (listing) dispatch({ type: 'LOADED', listing });
    });
  }, [load]);

  return { state, dispatch, load };
}
