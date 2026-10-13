// The static context-line scorer lives in the engine now (one shared module per concern, #886): Line's refusals rank
// their context lines with it, and the jev tools here score and evaluate against the same rules.
export * from '../../../packages/engine/line/context/contextScore.mjs';
