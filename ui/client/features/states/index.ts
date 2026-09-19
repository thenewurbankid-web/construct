// Public API for feature: states

/** Shared prop types for the designed empty / loading / error / offline states. */
export type * from './types';

/** "Nothing here yet" with a next action. */
export * from './components/EmptyState';

/** Work in progress (indeterminate or with a percentage). */
export * from './components/LoadingState';

/** Something failed, with a Try again action. */
export * from './components/ErrorState';

/** Local model offline: deterministic steps still work. */
export * from './components/OfflineState';

/** Plain-language copy for a failed request. */
export * from './domain/ErrorMessage';

/** Retry flow of the /states reference page. */
export * from './hooks/useStatesGallery';

/** The /states design-reference page (all four states side by side). */
export * from './controllers/StatesGalleryController';
