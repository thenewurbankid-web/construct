// Public API for feature: project-gate

/** Shared identifier and status types for the project-gate feature. */
export type * from './types';

/** Wraps a route's content and blocks it behind a project-init screen until
 * the currently selected directory resolves to a real Construct project. */
export * from './controllers/ProjectGateController';
