// Public API for feature: line-plan

/** The plan's shapes (a typed mirror of PlanView in packages/engine/line/contract.mjs) and the panel's view models. */
export type * from './types';

/** The open project's plan and the person's part in it (add a step, Approve, Try again, Leave as it is). */
export * from './hooks/useLinePlan';

/** The Plan panel, for the Components and Pages screens. */
export * from './controllers/LinePlanController';

/** Two modes: the Plan's chat options (PLAN_CHAT), joined to a screen's chat as "<screen>.plan.*" (withPlanOptions),
 * and the decision a picked option names (planDecisionOn) for the screen to run. */
export * from './domain/PlanChat';

/** Two modes: a screen's chat with the Plan's options joined. */
export * from './domain/PlanOptions';

/** Two modes: runs a picked Plan option through the panel's own actions. */
export * from './hooks/usePlanChatOptions';
