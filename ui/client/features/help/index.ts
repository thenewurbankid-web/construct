// Public API for feature: help

/** Shared identifier, help-data, and view-state types for the help feature. */
export type * from './types';

/** Renders the getting-started guide, attribution explainer, UI guide, and
 * the live CLI reference. */
export * from './controllers/HelpController';

/** Fetches and derives the CLI-reference view state from GET /api/help —
 * used by HelpController; exported for direct reuse/testing. */
export * from './hooks/useHelp';
