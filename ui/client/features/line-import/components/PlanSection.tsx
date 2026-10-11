import type { ImportApplyOutcome, ImportPlan, ImportViewModel } from '../types';
import { PlanSteps } from './PlanSteps';

type PlanSectionProps = { view: ImportViewModel; plan: ImportPlan | null; result: ImportApplyOutcome | null; onPlan: () => void; onApply: () => void; onUndo: () => void; onLeave: () => void };

/** "Show the plan" after a scan; the plan's steps and Apply once planned. */
export function PlanSection({ view, plan, result, onPlan, onApply, onUndo, onLeave }: PlanSectionProps) {
  if (plan) return <PlanSteps plan={plan} result={result} busy={view.busy} onApply={onApply} onUndo={onUndo} onLeave={onLeave} />;
  if (!view.canPlan) return null;
  return (
    <button type="button" className="li-btn li-btn--primary" disabled={view.busy} onClick={onPlan}>
      Show the plan
    </button>
  );
}
