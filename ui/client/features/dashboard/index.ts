// Public API for feature: dashboard

/** Shared identifier and command-shape types for the dashboard feature. */
export type * from './types';

/** Renders the four command forms (create/refactor/research/import) behind
 * the project gate. */
export * from './controllers/DashboardController';

/** Backs the four command forms' state and calls into ui/server — used by
 * DashboardController; exported for direct reuse/testing. */
export * from './hooks/useDashboard';

/** The Create / Refactor / Research / Import actions of the Features stage (the retired Dashboard's four forms). */
export * from './controllers/StageActionsController';
