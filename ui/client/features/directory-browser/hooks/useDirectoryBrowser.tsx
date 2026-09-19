'use client';

import { useCallback } from 'react';
import { appendPage } from '../domain/DirectoryPaging';
import { useDirectoryLoader } from './useDirectoryLoader';

/** Drives the folder picker: navigate, up, toggle hidden folders and page
 * through large directories on top of the loader. */
export function useDirectoryBrowser(initialPath?: string) {
  const { state, dispatch, showHiddenRef, load, navigate } = useDirectoryLoader(initialPath);

  const toggleHidden = useCallback(
    (value: boolean) => {
      showHiddenRef.current = value;
      dispatch({ type: 'SET_SHOW_HIDDEN', value });
      navigate(state.listing?.path);
    },
    [navigate, dispatch, showHiddenRef, state.listing?.path],
  );

  const loadMore = useCallback(async () => {
    const prev = state.listing;
    if (!prev) return;
    const next = await load(prev.path, prev.entries.length);
    if (next) dispatch({ type: 'LOADED', listing: appendPage(prev, next) });
  }, [load, dispatch, state.listing]);

  const goUp = useCallback(() => {
    if (state.listing?.parent) navigate(state.listing.parent);
  }, [navigate, state.listing]);

  return { ...state, navigate, goUp, toggleHidden, loadMore };
}
