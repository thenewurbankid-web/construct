// Public API for feature: ai-steps

/** The AI steps view models and the contract shapes it uses (a typed mirror of packages/engine/line/contract.mjs). */
export type * from './types';

/** Settings' read-only "AI steps" panel: every AI step's model, how it decides and its static fallback. */
export * from './controllers/AiStepsController';

/** The panel's view (loaded once), for reuse or tests. */
export * from './hooks/useAiSteps';
