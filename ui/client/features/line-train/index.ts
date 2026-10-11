// Public API for feature: line-train

/** Train Line's view shapes (the wire shapes mirror TRAIN_API in lib/lineContract.ts). */
export type * from './types';

/** Hook: everything the Train Line screen shows and does. */
export * from './hooks/useLineTrain';

/** The Train Line screen, for app/train. */
export * from './controllers/LineTrainController';

/** Hook: the scoreboard and Run eval. */
export * from './hooks/useScoreboard';

/** Hook: Claude's cases in the owner's review sample. */
export * from './hooks/useReviewQueue';

/** Hook: the world a request is drafted over and its closed choices. */
export * from './hooks/useTrainWorld';

/** Hook: the "Teach a new request" panel. */
export * from './hooks/useTeach';

/** Hook: a typed request and its draft being corrected. */
export * from './hooks/useDraft';

/** Hook: what the person does with the route cards. */
export * from './hooks/useRouteActions';
