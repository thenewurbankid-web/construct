// Public API for feature: directory-browser

/** Listing / badge view types. */
export type * from './types';

/** Drop-in "Your projects" list (#568): one flat level of the signed-in user's workspace,
 * calls onSelect(absolutePath). No navigation, no typed paths. */
export * from './controllers/DirectoryBrowserController';

/** List state/actions — used by the controller; exported for reuse/testing. */
export * from './hooks/useDirectoryBrowser';

/** Swappable presentational list (bring your own data source). */
export * from './components/DirectoryPicker';

/** Loader primitives (state + load) beneath useDirectoryBrowser. */
export * from './hooks/useDirectoryLoader';

/** Finds a folder by name directly inside the workspace (the "Try the sample shop" shortcut). */
export * from './hooks/useWorkspaceFolder';
