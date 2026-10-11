import type { ImportApplyOutcome, ImportPlan, ImportStep } from '../types';
import { TechDetails } from './TechDetails';

type Outcome = { ok: boolean; sentence: string } | undefined;
type PlanStepsProps = { plan: ImportPlan; result: ImportApplyOutcome | null; busy: boolean; onApply: () => void; onUndo: () => void; onLeave: () => void };

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

/** A late step was refused after `landed` steps: undo the whole import (recommended) or leave it and carry on. */
function UndoChoice({ landed, busy, onUndo, onLeave }: { landed: number; busy: boolean; onUndo: () => void; onLeave: () => void }) {
  return (
    <div className="li-undo" data-testid="li-undo-choice" role="group" aria-labelledby="li-undo-q">
      <p id="li-undo-q" className="li-sentence">
        {landed === 1 ? '1 step landed' : `${landed} steps landed`} before this one was refused. What should Line do?
      </p>
      <button type="button" className="li-btn li-btn--primary" disabled={busy} onClick={onUndo}>
        Undo the import (recommended)
      </button>
      <button type="button" className="li-btn" disabled={busy} onClick={onLeave}>
        Leave it as it is and carry on
      </button>
    </div>
  );
}

/** Step 3: the plan's steps as sentences (tool and arguments under Details), then Apply; after applying, how each step went. */
export function PlanSteps({ plan, result, busy, onApply, onUndo, onLeave }: PlanStepsProps) {
  const outcome = new Map((result?.steps ?? []).map((s) => [s.id, s]));
  const pending = result?.pending ?? null;
  const canApply = !result?.ok && !pending && plan.steps.length > 0;
  return (
    <section className="li-card" aria-labelledby="li-plan-h">
      <h2 id="li-plan-h" className="li-h2">The plan</h2>
      <p className="li-sentence" data-testid="li-plan-summary">{plan.summary}</p>
      <ol className="li-steps">
        {plan.steps.map((s) => <Step key={s.id} step={s} outcome={outcome.get(s.id)} />)}
      </ol>
      {pending && <UndoChoice landed={pending.landed} busy={busy} onUndo={onUndo} onLeave={onLeave} />}
      {canApply && (
        <button type="button" className="li-btn li-btn--primary" disabled={busy} onClick={onApply}>
          Apply
        </button>
      )}
    </section>
  );
}
