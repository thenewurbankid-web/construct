// Public API for feature: blocks

/** View models the controller hands to the presentation components. */
export type * from './types';

/** Server response shapes (/api/blocks), the settings and the screen state (#407). */
export type * from './domain/BlockTypes';

/** The Blocks tab (Browser pane of the Features screen): the mechanical blocks, their settings, and "Run this block". */
export * from './controllers/BlocksController';

/** The tab as a shell tab, for the screen that registers it. */
export * from './pages/BlocksShellTabs';

/** Reads the catalogue and saves settings, one block at a time. */
export * from './hooks/useBlocks';
