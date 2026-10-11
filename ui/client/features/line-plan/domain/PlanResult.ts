// Pure (DOMAIN-001): what a plan step that ran left behind (its change result), and the step the person last ran.
import type { LastRun, LineStepResult, PlanStepView, PlanView } from '../types.ts';

/** A line.* change result, or null for any other step's result. */
export function changeResult(step: PlanStepView): LineStepResult | null {
  const r = step.result as Partial<LineStepResult> | null;
  return r && typeof r === 'object' && Array.isArray(r.checks) && r.apply && typeof r.apply === 'object' ? (r as LineStepResult) : null;
}

/** The step `stepId` once it ran (done or needs the person), for a screen's notice; null before it ran. */
export function lastRun(view: PlanView | null, stepId: string | null): LastRun | null {
  const ran = view && stepId ? view.steps.find((s) => s.id === stepId && (s.state === 'done' || s.state === 'needs-you' || s.state === 'needs-fix')) : undefined;
  if (!ran) return null;
  const r = changeResult(ran);
  return { stepId: ran.id, tool: ran.tool, apply: r ? r.apply : null, sentence: ran.sentence };
}
