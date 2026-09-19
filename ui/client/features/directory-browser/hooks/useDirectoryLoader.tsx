'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { toListingView } from '../domain/DirectoryListing';
import { browseDirectory } from '../services/DirectoryBrowser';
import { directoryBrowserReducer, initialDirectoryBrowserState } from '../workflows/DirectoryBrowser';

/** Owns the picker's state and the load/navigate primitives; starts at
 * `initialPath`, falling back to the server's default root if that path is
 * not browsable. */
export function useDirectoryLoader(initialPath?: string) {
  const [state, dispatch] = useReducer(directoryBrowserReducer, initialDirectoryBrowserState);
  const showHiddenRef = useRef(false);

  const load = useCallback(async (path: string | undefined, offset?: number) => {
    dispatch({ type: 'LOAD_START' });
    const raw = await browseDirectory({ path, showHidden: showHiddenRef.current, offset });
    if (!raw.ok) {
      dispatch({ type: 'LOAD_ERROR', error: raw.error });
      return null;
    }
    return toListingView(raw);
  }, []);

  const navigate = useCallback(
    async (path?: string) => {
      const listing = await load(path);
      if (listing) dispatch({ type: 'LOADED', listing });
      return listing;
    },
    [load],
  );

  useEffect(() => {
    navigate(initialPath).then((l) => {
      if (!l && initialPath) navigate(undefined);
    });
  }, [navigate, initialPath]);

  return { state, dispatch, showHiddenRef, load, navigate };
}
