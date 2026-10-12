// Public API for feature: line-features

/** The Line contract shapes the Features screen uses (a typed mirror of packages/engine/line/contract.mjs). */
export type * from './types';

/** The Features screen's feature part: the Line Features view for a Line project, the given fallback for any other. */
export * from './controllers/LineFeaturesController';

/** The Line Features screen's state (feature list, chosen feature, its detail), for reuse or tests. */
export * from './hooks/useLineFeatures';

/** cd1: the Features chat (options, messages, picks, the name question; create and fix add plan steps). */
export * from './hooks/useFeatureChat';

/** Two modes on Features: the mode, the breadcrumb and what a crumb does. */
export * from './hooks/useFeaturesModes';
