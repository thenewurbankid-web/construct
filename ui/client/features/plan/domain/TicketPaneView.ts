// Pure (DOMAIN-001): the ticket pane's props from the screen state.
import type { ScreenState } from './PlanTypes.ts';
import { constraintsView, proposalView } from './ConstraintsView.ts';
import type { TicketHandlers } from '../types.ts';
import type { TicketPaneProps } from '../types.ts';

export const buildTicketPane = (s: ScreenState, h: TicketHandlers): TicketPaneProps => ({
  ticket: s.ticket,
  constraints: s.context ? constraintsView(s.context.constraints) : null,
  features: s.context?.features ?? [],
  picked: s.picked,
  proposals: s.proposals?.map(proposalView) ?? null,
  proposalsBusy: s.proposalsStatus === 'loading',
  proposalsError: s.proposalsError,
  accepted: s.accepted,
  canPropose: !!(s.ticket.body.trim() || s.ticket.title.trim()),
  analyseBusy: s.impactStatus === 'loading',
  canAnalyse: s.picked.length + s.accepted.length > 0,
  ...h,
});
