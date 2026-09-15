// Public API for feature: core

/** Shared identifier and value types for the core feature. */
export type * from './types';

/** Composes the core feature's page/behavior for the route to render. */
export * from './controllers/CoreController';

/** React-facing hook exposing core feature state/actions to components. */
export * from './hooks/useCore';
