// Public API for feature: plan

/** View models the controller hands to the presentation components. */
export type * from './types';

/** Server response shapes (/api/plan), the plan being edited and the screen state (#289, #332). */
export type * from './domain/PlanTypes';

/** The Plan mode screen (`/plan`): ticket (left), impact (middle), plan (right). */
export * from './controllers/PlanController';

/** Everything the screen does, composed from the hooks below. */
export * from './hooks/usePlanScreen';

/** Reads the project's constraints, features and the flow catalogue. */
export * from './hooks/usePlanContext';

/** The plan document and the server's verdict on it after every edit. */
export * from './hooks/usePlanValidation';

/** Ticket text to unit proposals to impact. No model. */
export * from './hooks/useSeedActions';

/** Add, remove, reorder, re-tag and edit the steps of the plan. */
export * from './hooks/useStepActions';

/** Run plan: the server re-validates and starts the process. */
export * from './hooks/usePlanRun';

/** The plan check and Run over /api/plan, for the screens that hand a plan to the same run path (the Requirement screen, #642). */
export * from './services/PlanCheckApi';
