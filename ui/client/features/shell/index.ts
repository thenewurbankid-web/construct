// Public API for feature: shell

/** Shared shell types (themes, ...). */
export type * from './types';

/** Dark/light theme switch (persisted, no flash). */
export * from './controllers/ThemeController';

/** Pure theme helpers + the pre-paint init script for the document head. */
export * from './domain/ThemeInit';

/** Current theme + toggle (used by ThemeController). */
export * from './hooks/useTheme';
