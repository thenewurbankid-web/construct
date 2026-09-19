'use client';

import { useDirectoryBrowser } from '../hooks/useDirectoryBrowser';
import { DirectoryBrowserPage } from '../pages/DirectoryBrowserPage';

/** Mount anywhere a folder must be chosen. `onSelect` receives the absolute
 * path the user picked; `initialPath` (optional) is where browsing starts. */
export function DirectoryBrowserController({ onSelect, initialPath }: { onSelect: (path: string) => void; initialPath?: string }) {
  const b = useDirectoryBrowser(initialPath);
  return (
    <DirectoryBrowserPage
      listing={b.listing}
      loading={b.loading}
      error={b.error}
      showHidden={b.showHidden}
      onNavigate={b.navigate}
      onUp={b.goUp}
      onSelect={onSelect}
      onToggleHidden={b.toggleHidden}
      onLoadMore={b.loadMore}
    />
  );
}
