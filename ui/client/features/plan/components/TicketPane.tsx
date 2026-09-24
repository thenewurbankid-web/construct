import type { TicketPaneProps } from '../types';
import { ConstraintsList } from './ConstraintsList';
import { NoteStatusLine } from './NoteStatusLine';
import { TicketFields } from './TicketFields';
import { UnitPicker } from './UnitPicker';

/** Left pane: the ticket as free text, what the plan will be held to, and which units it is about. */
export function TicketPane(p: TicketPaneProps) {
  return (
    <div className="pl-side" data-testid="plan-ticket">
      <TicketFields ticket={p.ticket} onTicket={p.onTicket} />
      <NoteStatusLine status={p.noteStatus} onRetry={p.onRetry} onLoadTheirs={p.onLoadTheirs} onKeepMine={p.onKeepMine} onKeepPlan={p.onKeepPlan} />
      <ConstraintsList constraints={p.constraints} />
      <UnitPicker {...p} />
      <button type="button" className="dg-btn pl-primary" onClick={p.onAnalyse} disabled={!p.canAnalyse || p.analyseBusy} data-testid="plan-analyse">
        {p.analyseBusy ? 'Analysing...' : 'Analyse impact'}
      </button>
    </div>
  );
}
