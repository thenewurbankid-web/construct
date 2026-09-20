import type { ShellTab } from '@/features/shell';
import { PlanPane } from '../components/PlanPane';
import { TicketPane } from '../components/TicketPane';
import type { PlanPaneProps, TicketPaneProps } from '../types';

// Presentation-only: Plan mode's pieces as shell tabs (Browser: the ticket, Tools: the plan). The controller
// registers these into the shell's slot registry while the screen is mounted.
export function planShellTabs(ticket: TicketPaneProps, plan: PlanPaneProps): { browser: ShellTab; tools: ShellTab } {
  return {
    browser: { id: 'plan-ticket', title: 'Ticket', preferred: true, render: () => <TicketPane {...ticket} /> },
    tools: { id: 'plan-plan', title: 'Plan', preferred: true, badge: plan.count, render: () => <PlanPane {...plan} /> },
  };
}
