export type DirectoryBrowserId = string;

/** One sub-directory as returned by ui/server's GET /api/fs/browse (core:
 * src/dir-browser.mjs). Directories only — never files or file contents. */
export type RawDirEntry = {
  name: string;
  path: string;
  hasArchitectureYml: boolean;
  hasPackageJson: boolean;
  isReact: boolean;
  isConstructProject: boolean;
};

export type RawDirListing = {
  ok: true;
  path: string;
  parent: string | null;
  roots: string[];
  entries: RawDirEntry[];
  total: number;
  offset: number;
  limit: number;
  truncated: boolean;
  current: Omit<RawDirEntry, 'name' | 'path'>;
};

export type BrowseFailure = { ok: false; error: string };

export type DirBadge = { key: 'construct' | 'react' | 'package'; label: string };

export type DirEntryView = { name: string; path: string; badges: DirBadge[]; looksLikeProject: boolean };

/** Props of the swappable presentational picker (components/DirectoryPicker). */
export type DirectoryPickerProps = {
  listing: DirListingView | null;
  loading: boolean;
  error: string | null;
  showHidden: boolean;
  onNavigate: (path: string) => void;
  onUp: () => void;
  onSelect: (path: string) => void;
  onToggleHidden: (value: boolean) => void;
  onLoadMore: () => void;
};

/** UI-ready listing (see domain/DirectoryListing.tsx). */
export type DirListingView = {
  path: string;
  parent: string | null;
  entries: DirEntryView[];
  total: number;
  truncated: boolean;
  currentBadges: DirBadge[];
};
