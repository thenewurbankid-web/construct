// Public API for feature: requirement

/** View models the controller hands to the presentation components. */
export type * from './types';

/** Server response shapes (/api/requirement), the timeline and the screen state (#642). */
export type * from './domain/RequirementTypes';

/** The Requirement screen (`/requirement`): a sentence read back as card, placement and timeline, then approved into a plan. */
export * from './controllers/RequirementController';

/** Everything the screen does, composed from the reducer and the two other features' routes. */
export * from './hooks/useRequirement';

/** The placement read back in the order it runs, as steps with one plain-English line each. Pure. */
export * from './domain/Timeline';
