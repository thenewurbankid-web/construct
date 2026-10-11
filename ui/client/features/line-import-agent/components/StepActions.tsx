import type { AgentActions, StepRowModel } from '../types';

type StepActionsProps = { row: StepRowModel; busy: boolean; actions: AgentActions };

/** What a step allows before it runs: Approve, Change, Skip (or Bring back), Move up, Move down. */
export function StepActions({ row, busy, actions }: StepActionsProps) {
  const up = row.up ?? -1;
  const down = row.down ?? -1;
  return (
    <div className="la-row la-actions" hidden={row.editing}>
      <button type="button" className="la-btn la-btn--small" disabled={busy} hidden={!row.canApprove} onClick={() => actions.approveStep(row.id)} aria-label={`Approve step ${row.n}`}>Approve</button>
      <button type="button" className="la-btn la-btn--small" disabled={busy} hidden={!row.canEdit} onClick={() => actions.openEdit(row.id)} aria-label={`Change step ${row.n}`}>Change</button>
      <button type="button" className="la-btn la-btn--small" disabled={busy} hidden={!row.skipLabel} onClick={() => actions.skip(row.id)} aria-label={`${row.skipLabel} step ${row.n}`}>{row.skipLabel}</button>
      <button type="button" className="la-btn la-btn--small" disabled={busy} hidden={row.up === null} onClick={() => actions.move(row.id, up)} aria-label={`Move step ${row.n} up`}>Move up</button>
      <button type="button" className="la-btn la-btn--small" disabled={busy} hidden={row.down === null} onClick={() => actions.move(row.id, down)} aria-label={`Move step ${row.n} down`}>Move down</button>
    </div>
  );
}
