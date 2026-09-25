'use client';

import { useCallback } from 'react';
import { appendPage } from '../domain/DirectoryPaging';
import { directoryListing } from '../workflows/DirectoryBrowser';
import { useDirectoryLoader } from './useDirectoryLoader';

/** Drives the "Your projects" list: loads it and pages through a very long one. */
export function useDirectoryBrowser() {
  const { state, dispatch, load } = useDirectoryLoader();

  const loadMore = useCallback(async () => {
    const prev = directoryListing(state);
    if (!prev) return;
    const next = await load(prev.entries.length);
    if (next) dispatch({ type: 'LOADED', listing: appendPage(prev, next) });
  }, [load, dispatch, state]);

  return { state, loadMore };
}
