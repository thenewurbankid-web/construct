// Public API for feature: spec-breakdown (#748, R6)

/** Shared shapes for a machine-spec.v1 report, its read-back and generation result. */
export type * from './types';

/** The screen: reads `?file=`/`?feature=` and renders the table + read-back, gated behind an open project. */
export * from './controllers/SpecBreakdownController';
