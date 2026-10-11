import { PlanEmpty } from '../components/PlanEmpty';
import { PlanError } from '../components/PlanError';
import { PlanStep } from '../components/PlanStep';
import '../components/line-plan.css';
import type { PlanControls, PlanStepRow } from '../types';

/** The Plan panel: every Line action on this screen is a step of the project's plan. A write waits here for your
 * approval ("Waiting for your approval: ..."), with what is already there; Approve runs it and shows what happened.
 * Newest step first; the tool call and checks sit under each step's Details. */
export function LinePlanPage({ plan }: { plan: PlanControls }) {
  const step = (row: PlanStepRow) => <PlanStep key={row.id} row={row} busy={plan.busy} onApprove={plan.approve} onChoose={plan.choose} />;
  return (
    <section className="lpl" aria-labelledby="lpl-head" data-testid="line-plan" aria-busy={plan.busy}>
      <h2 id="lpl-head" className="lpl-head">
        Plan <small>Each change waits for your approval.</small>
      </h2>
      <PlanError sentence={plan.error} />
      <PlanEmpty empty={!plan.rows.length} />
      <ol className="lpl-steps" aria-label="Plan steps">
        {plan.rows.map(step)}
      </ol>
      <details className="lpl-tech">
        <summary>Where plans are kept</summary>
        <span>{plan.storeSentence}</span>
      </details>
    </section>
  );
}
