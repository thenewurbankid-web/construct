import type { ImportApplyResult, ImportPlan, ImportStep } from '../types';
import { TechDetails } from './TechDetails';

type Outcome = { ok: boolean; sentence: string } | undefined;
type PlanStepsProps = { plan: ImportPlan; result: ImportApplyResult | null; busy: boolean; onApply: () => void };

const STATE_OF = (o: Outcome) => (o === undefined ? 'todo' : o.ok ? 'done' : 'refused');

function Step({ step, outcome }: { step: ImportStep; outcome: Outcome }) {
  const refused = outcome !== undefined && !outcome.ok;
  return (
    <li className="li-step" data-testid="li-step" data-state={STATE_OF(outcome)}>
      <p className="li-sentence">{refused ? outcome.sentence : step.sentence}</p>
      {outcome?.ok && <span className="li-chip li-chip--ok">Done</span>}
      <TechDetails summary="Details" lines={[step.tool, JSON.stringify(step.args)]} />
    </li>
  );
}

/** Step 3: the plan's steps as sentences (tool and arguments under Details), then Apply; after applying, how each step went. */
export function PlanSteps({ plan, result, busy, onApply }: PlanStepsProps) {
  const outcome = new Map((result?.steps ?? []).map((s) => [s.id, s]));
  const canApply = !result?.ok && plan.steps.length > 0;
  return (
    <section className="li-card" aria-labelledby="li-plan-h">
      <h2 id="li-plan-h" className="li-h2">The plan</h2>
      <p className="li-sentence" data-testid="li-plan-summary">{plan.summary}</p>
      <ol className="li-steps">
        {plan.steps.map((s) => <Step key={s.id} step={s} outcome={outcome.get(s.id)} />)}
      </ol>
      {canApply && (
        <button type="button" className="li-btn li-btn--primary" disabled={busy} onClick={onApply}>
          Apply
        </button>
      )}
    </section>
  );
}
