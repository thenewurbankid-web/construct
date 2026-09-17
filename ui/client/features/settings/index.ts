// Public API for feature: settings

/** Shared identifier and settings-shape types for the settings feature. */
export type * from './types';

/** Renders the settings form (project directory + LLM provider) and the
 * current-resolution summary. */
export * from './controllers/SettingsController';

/** Loads and saves settings — used by SettingsController; exported for
 * direct reuse/testing. */
export * from './hooks/useSettings';
