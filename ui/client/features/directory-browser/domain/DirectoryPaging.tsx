import type { DirListingView } from '../types';

/** Merge a further page onto an existing listing (Load more). */
export function appendPage(prev: DirListingView, next: DirListingView): DirListingView {
  return { ...next, entries: [...prev.entries, ...next.entries] };
}
