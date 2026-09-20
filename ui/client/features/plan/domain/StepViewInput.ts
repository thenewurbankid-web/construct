import type { FlowInfo, PlanError, PlanStep, Validation } from './PlanTypes.ts';

/** Inputs the domain needs to build a StepView. */
export type StepViewInput = { step: PlanStep; flow: FlowInfo | null; preview: Validation['steps'][number] | null; errors: PlanError[] };
