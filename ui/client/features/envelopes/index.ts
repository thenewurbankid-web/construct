// Public API for feature: envelopes

/** View models and server response shapes the controller reads/hands to presentation components. */
export type * from './types';

/** The Envelopes tab (Browser pane of the Features screen): every saved flow, plus the compose center stage. */
export * from './controllers/EnvelopesController';

/** The tab as a shell tab, for the screen that registers it. */
export * from './pages/EnvelopesShellTab';

/** Reads every saved flow for the current project (auto-run + on demand). */
export * from './hooks/useEnvelopes';

/** The compose draft: add/reorder/remove steps, load a saved flow's steps as the starting point. */
export * from './hooks/useCompose';

/** Reads the real plan-flow catalogue the compose step picker offers. */
export * from './hooks/useFlowCatalogue';
