// Public API for feature: feature-catalog

/** Shapes of the feature index and one feature's summary, and the details view model. */
export type * from './types';

/** The Features screen's Browser list and stage details (composed into the Plan screen's stage as a slot). */
export * from './controllers/FeaturesScreenController';

/** The list and details hooks (used by FeaturesScreenController; exported for direct reuse/testing). */
export * from './hooks/useFeatureList';
export * from './hooks/useFeatureSummary';
