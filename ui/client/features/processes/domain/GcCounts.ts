// Pure (DOMAIN-001): #416 -- turning the dry-run gc report into what the drawer shows: one total count, and the
// plain-words lines the "Details" popover lists.
import type { GcDetailLine, GcReport } from '../types.ts';

/** The single number the drawer's "N item(s) can be cleaned up" line shows: every dead worktree, orphaned
 * branch and stale-approval record the sweep found, added together. 0 when there is nothing to report, or the
 * report has not arrived yet. */
export function gcCleanupCount(gc: GcReport | null): number {
  if (!gc) return 0;
  return gc.counts.worktrees + gc.counts.branches + gc.counts.staleApprovals;
}

/** One line per item, in plain words, for the "Details" popover. */
export function gcDetailLines(gc: GcReport | null): GcDetailLine[] {
  if (!gc) return [];
  const lines: GcDetailLine[] = [];
  for (const w of gc.worktrees.found) lines.push({ key: `wt-${w}`, text: `Dead-owner worktree ${w}` });
  for (const b of gc.branches.found) lines.push({ key: `br-${b.branch}`, text: `Orphaned branch ${b.branch} (${b.reason})` });
  for (const s of gc.staleApprovals) lines.push({ key: `sa-${s.id}`, text: `${s.id}: ${s.pending.length} artifact(s) pending approval, ${s.ageDays}d old` });
  return lines;
}
