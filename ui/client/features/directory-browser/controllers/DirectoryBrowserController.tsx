'use client';

import { useDirectoryBrowser } from '../hooks/useDirectoryBrowser';
import { DirectoryBrowserPage } from '../pages/DirectoryBrowserPage';

/** Mount anywhere a project must be chosen. `onSelect` receives the absolute path of the project the user
 * picked from their own workspace (#568: a flat list; there is no folder navigation to start from). */
export function DirectoryBrowserController({ onSelect }: { onSelect: (path: string) => void }) {
  const b = useDirectoryBrowser();
  return <DirectoryBrowserPage listing={b.listing} loading={b.loading} error={b.error} onSelect={onSelect} onLoadMore={b.loadMore} />;
}
