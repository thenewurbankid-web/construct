import type { TicketFieldsProps } from '../types';

/** The ticket, as free text. Nothing typed here is sent to a model. */
export function TicketFields({ ticket, onTicket }: TicketFieldsProps) {
  return (
    <>
      <label className="pl-field">
        <span className="pl-h">Notes</span>
        <input type="text" value={ticket.title} onChange={(e) => onTicket({ title: e.target.value })} placeholder="A short title" aria-label="Note title" data-testid="plan-ticket-title" />
      </label>
      <label className="pl-field">
        <span className="pl-sr">Note text</span>
        <textarea value={ticket.body} onChange={(e) => onTicket({ body: e.target.value })} placeholder="Describe the change in your own words. Naming a feature, a file or a route helps." aria-label="Note text" data-testid="plan-ticket-body" />
      </label>
      <p className="pl-hint">Plain text. Nothing is sent to a model.</p>
    </>
  );
}
