// Public API for feature: project-gate

/** Shared identifier and status types for the project-gate feature. */
export type * from './types';

/** Wraps a route's content and blocks it behind a project-init screen until
 * the currently selected directory resolves to a real Construct project. */
export * from './controllers/ProjectGateController';

/** Fetches project status and runs init-here — used by
 * ProjectGateController; exported for direct reuse/testing. */
export * from './hooks/useProjectGate';

/** The "Open a project" screen (projects as cards, New project, From GitHub), shown while no project is open. */
export * from './controllers/OpenProjectController';

/** The Open-a-project screen's tab, kept in the URL. */
export * from './hooks/useOpenProjectTab';
