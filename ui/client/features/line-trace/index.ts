// Public API for feature: line-trace

/** Trace and Auto shapes (a typed mirror of packages/engine/line/contract.mjs TraceMatch and AutoAction) and view models. */
export type * from './types';

/** The Trace bar for a Line screen (Components, Pages, Features). */
export * from './controllers/LineTraceController';

/** Trace and Auto on one screen: lit controls, links to other screens, Auto's player. */
export * from './hooks/useLineTrace';

/** Auto's player on its own (the cursor, the moves on the real controls), for a screen that composes its own bar. */
export * from './hooks/useAutoPlayer';

/** The tab's Trace and Auto settings (modes, request, Auto approval for this session, speed, history). */
export * from './hooks/useTraceSettings';
