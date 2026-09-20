// Pure (DOMAIN-001): the order of the list, and the sentence that explains it (the ordering rule is
// visible, not a hidden score).
import type { AnalysisDone, BranchRow, ListOrder } from '../types.ts';

/** How many indicators need attention, then how many findings: the number the list is ranked by. */
export const riskScore = (a: AnalysisDone): number => a.indicators.filter((i) => i.status === 'attention').length * 1000 + a.findings;

export function orderExplanation(order: ListOrder): string {
  return order === 'risk'
    ? 'Riskiest first: branches with more indicators needing attention, then more findings, come first. Branches still being analysed follow.'
    : 'Newest first: by the date of the last commit.';
}

const time = (b: BranchRow) => Date.parse(b.date) || 0;

/** Ranked copy of the rows. Ties fall back to the newest commit, then the name, so the order is stable. */
export function rankBranches(rows: BranchRow[], order: ListOrder): BranchRow[] {
  const score = (b: BranchRow) => (b.analysis.state === 'done' ? riskScore(b.analysis) : -1);
  return [...rows].sort((a, b) => {
    if (order === 'risk') {
      const d = score(b) - score(a);
      if (d !== 0) return d;
    }
    return time(b) - time(a) || a.name.localeCompare(b.name);
  });
}
