// Public API for feature: line-workflows

/** The Line workflow shapes the tab uses (a typed mirror of packages/engine/line/contract.mjs LineWorkflow). */
export type * from './types';

/** A feature's Workflows tab with its Plan panel: workflows as state machines between the feature's pages. */
export * from './controllers/LineWorkflowsController';

/** The tab's state (list, chosen workflow, the person's changes as plan steps), for reuse or tests. */
export * from './hooks/useLineWorkflows';
