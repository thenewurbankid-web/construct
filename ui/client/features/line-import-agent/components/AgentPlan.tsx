import type { AgentActions, StepRowModel } from '../types';
import { StepRow } from './StepRow';

type AgentPlanProps = { rows: StepRowModel[]; busy: boolean; actions: AgentActions };

/** The import plan (line/import-plan.json in the folder), in the order it runs. */
export function AgentPlan({ rows, busy, actions }: AgentPlanProps) {
  if (!rows.length) return null;
  const row = (r: StepRowModel) => <StepRow key={r.id} row={r} busy={busy} actions={actions} />;
  return (
    <section className="la-card" aria-labelledby="la-plan-h">
      <h2 id="la-plan-h" className="la-h2">The plan</h2>
      <p className="la-hint">Each step is one change Line checks before it lands. Change, skip or reorder steps before they run; every change is recorded.</p>
      <ol className="la-steps">{rows.map(row)}</ol>
    </section>
  );
}
