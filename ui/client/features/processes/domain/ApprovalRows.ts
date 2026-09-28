// Pure (DOMAIN-001): which processes have files waiting on a human decision, and how many.
import type { ProcessSummary } from '../types.ts';

export type ApprovalRow = { id: string; title: string; pending: number };

/** Processes with at least one artifact awaiting approval, in list order. */
export function buildApprovalRows(summaries: ProcessSummary[]): ApprovalRow[] {
  return summaries.filter((s) => s.pendingApproval > 0).map((s) => ({ id: s.id, title: s.title, pending: s.pendingApproval }));
}

/** Total files waiting across every process; the Approvals tab's badge, mirroring the Processes pill. */
export function pendingApprovalCount(summaries: ProcessSummary[]): number {
  return summaries.reduce((sum, s) => sum + s.pendingApproval, 0);
}
