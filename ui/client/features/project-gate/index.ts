// Public API for feature: project-gate

/** Shared identifier and status types for the project-gate feature. */
export type * from './types';

/** Wraps a route's content and blocks it behind a project-init screen until
 * the currently selected directory resolves to a real Construct project. */
export * from './controllers/ProjectGateController';

/** Fetches project status and runs init-here — used by
 * ProjectGateController; exported for direct reuse/testing. */
export * from './hooks/useProjectGate';

/** Two modes on "Open a project": what the chat reads and Reopen / the sample. */
export * from './hooks/useOpenModes';
