'use client';

import { useDirectoryBrowser } from '../hooks/useDirectoryBrowser';
import { DirectoryBrowserPage } from '../pages/DirectoryBrowserPage';
import { directoryError, directoryIsLoading, directoryListing } from '../workflows/DirectoryBrowser';

/** Mount anywhere a project must be chosen. `onSelect` receives the absolute path of the project the user
 * picked from their own workspace (#568: a flat list; there is no folder navigation to start from). */
export function DirectoryBrowserController({ onSelect }: { onSelect: (path: string) => void }) {
  const b = useDirectoryBrowser();
  return <DirectoryBrowserPage listing={directoryListing(b.state)} loading={directoryIsLoading(b.state)} error={directoryError(b.state)} onSelect={onSelect} onLoadMore={b.loadMore} />;
}
