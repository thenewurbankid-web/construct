// Pure (DOMAIN-001): which step each named validator error belongs to, so it can be shown next to that step
// in plain words. Paths look like `steps[2].args.name`; anything without a step index is about the plan.
import type { PlanError, PlanStep } from './PlanTypes.ts';
import type { ErrorView } from '../types.ts';

const STEP_PATH = /^steps\[(\d+)\]/;

export function splitErrors(steps: PlanStep[], errors: PlanError[]): { byStep: Record<string, PlanError[]>; plan: PlanError[] } {
  const byStep: Record<string, PlanError[]> = {};
  const plan: PlanError[] = [];
  for (const e of errors) {
    const m = STEP_PATH.exec(e.path);
    const step = m ? steps[Number(m[1])] : undefined;
    if (step) (byStep[step.id] ||= []).push(e);
    else plan.push(e);
  }
  return { byStep, plan };
}

/** The step-level sentence for the reader: a friendly lead by error code, then the validator's own words. */
const LEAD: Record<string, string> = {
  STEP_DEPENDENCY_FORWARD: 'Out of order',
  STEP_DEPENDENCY_UNKNOWN: 'Depends on a step that is not in the plan',
  STEP_EXECUTOR_LLM_CONFLICT: 'A model is involved but this step is tagged Deterministic',
  STEP_EXECUTOR_NOT_ALLOWED: 'This step cannot be run that way',
  STEP_ARG_MISSING: 'Something is missing',
  STEP_ARG_ENUM: 'Not an allowed value',
  STEP_TOUCHES_REQUIRED: 'It must say what it changes',
  COCKPIT_ARG_PATH: 'That path is not allowed',
  COCKPIT_ARG_DASH: 'That value is not allowed',
  COCKPIT_LLM_PROVIDER: 'Only the local model can be used',
  COCKPIT_FLOW_NOT_OFFERED: 'Not offered here',
};

export const errorLead = (code: string): string => LEAD[code] ?? 'Needs attention';

/** The errors as the rows a pane shows: a friendly lead, then the validator's own sentence. */
export const errorViews = (errors: PlanError[]): ErrorView[] => errors.map((e, i) => ({ key: `${e.code}-${i}`, code: e.code, lead: errorLead(e.code), plain: e.plain }));
