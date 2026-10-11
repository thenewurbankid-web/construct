// Public API for feature: line-trace

/** Trace and Auto shapes (a typed mirror of packages/engine/line/contract.mjs TraceMatch and AutoAction) and view models. */
export type * from './types';

/** The Trace bar for a Line screen (Components, Pages, Features). */
export * from './controllers/LineTraceController';

/** Trace and Auto on one screen: lit controls, links to other screens, Auto's player. */
export * from './hooks/useLineTrace';
