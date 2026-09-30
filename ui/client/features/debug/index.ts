// Public API for feature: debug

/** View models the controller hands to the presentation components. */
export type * from './types';

/** Server response shapes (/api/debug), the answers and the screen state (LIN-137). */
export type * from './domain/DebugTypes';

/** The Debug screen (`/debug`): reproduce -> isolate -> fix -> verify, then approved into a plan. */
export * from './controllers/DebugController';

/** Everything the screen does, composed from the reducer and the Plan feature's run route. */
export * from './hooks/useDebug';
