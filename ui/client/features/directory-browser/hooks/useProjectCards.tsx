'use client';

import { useMemo } from 'react';
import { toProjectCard } from '../domain/ProjectCard';
import { directoryError, directoryIsLoading, directoryListing } from '../workflows/DirectoryBrowser';
import { useDirectoryBrowser } from './useDirectoryBrowser';

/** The workspace's projects as cards (the Open-a-project screen): the cards (null while the first page loads), how many
 * there are, and Show more for a very long list. */
export function useProjectCards() {
  const b = useDirectoryBrowser();
  const listing = directoryListing(b.state);
  const cards = useMemo(() => (listing ? listing.entries.map(toProjectCard) : null), [listing]);
  return {
    cards,
    count: listing ? listing.entries.length : null,
    total: listing?.total ?? 0,
    truncated: listing?.truncated === true,
    loading: directoryIsLoading(b.state),
    error: directoryError(b.state),
    loadMore: b.loadMore,
  };
}
