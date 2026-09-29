// Public API for feature: rules

/** View models and server response shapes the controller reads/hands to presentation components. */
export type * from './types';

/** The Rules tab (Browser pane of the Features screen): every active rule, severity, "why" and live violation count. */
export * from './controllers/RulesController';

/** The tab as a shell tab, for the screen that registers it. */
export * from './pages/RulesShellTab';

/** Reads every rule for the current project (auto-run + on demand). */
export * from './hooks/useRules';

/** Reads and edits project.framework/features.root (#395 slice 5). */
export * from './hooks/useProjectSettings';
