// Public API for feature: envelopes

/** View models and server response shapes the controller reads/hands to presentation components. */
export type * from './types';

/** The Envelopes tab (Browser pane of the Features screen): every saved flow, read-only. */
export * from './controllers/EnvelopesController';

/** The tab as a shell tab, for the screen that registers it. */
export * from './pages/EnvelopesShellTab';

/** Reads every saved flow for the current project (auto-run + on demand). */
export * from './hooks/useEnvelopes';
