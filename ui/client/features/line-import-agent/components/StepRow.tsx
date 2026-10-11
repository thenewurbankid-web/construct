import type { AgentActions, StepRowModel } from '../types';
import { StepActions } from './StepActions';
import { StepEditor } from './StepEditor';
import { TechDetails } from './TechDetails';

type StepRowProps = { row: StepRowModel; busy: boolean; actions: AgentActions };

/** One step of the import plan: what it does, its review and run state, what happened, and what it allows now. */
export function StepRow({ row, busy, actions }: StepRowProps) {
  return (
    <li className="la-step" data-testid="la-step" data-step={row.id} data-run={row.run} data-review={row.review}>
      <span className="la-n">{row.n}</span>
      <div className="la-step-body">
        <p className="la-sentence">{row.sentence}</p>
        <p className="la-meta">
          <span className={`la-chip la-chip--${row.review}`}>{row.reviewLabel}</span>
          <span className={`la-chip la-chip--run-${row.run}`}>{row.runLabel}</span>
        </p>
        <p className="la-hint" hidden={!row.outcome}>{row.outcome}</p>
        <StepActions row={row} busy={busy} actions={actions} />
        <StepEditor key={String(row.editing)} row={row} busy={busy} onSave={actions.saveEdit} onCancel={() => actions.openEdit(null)} />
        <TechDetails summary="Details" lines={row.details} />
      </div>
    </li>
  );
}
