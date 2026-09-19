// Public API for feature: directory-browser

/** Listing / badge view types. */
export type * from './types';

/** Drop-in folder picker: renders an allowlisted server-side directory
 * browser and calls onSelect(absolutePath). */
export * from './controllers/DirectoryBrowserController';

/** Browsing state/actions — used by the controller; exported for reuse/testing. */
export * from './hooks/useDirectoryBrowser';

/** Swappable presentational picker (bring your own data source). */
export * from './components/DirectoryPicker';

/** Loader primitives (state + navigate) beneath useDirectoryBrowser. */
export * from './hooks/useDirectoryLoader';
