// How commit-on-save (#283) talks about itself: mode names, windows, and what each mode will
// actually do. Pure — no React, no fetch — so the wording a user reads while the tool writes to
// their git history is unit-testable on its own.
import type { CommitMode } from '../types';

export const MODE_LABELS: Record<CommitMode, string> = {
  coalesce: 'Group rapid saves',
  'every-save': 'Every save',
  manual: 'Only when I click Commit',
};

/** A duration a human reads at a glance: `30s`, `2m`, `2m 30s`. */
export function formatWindow(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'immediately';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (!m) return `${s}s`;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** What a mode actually does, in the user's terms — shown next to the choice, not buried in docs. */
export function describeMode(mode: CommitMode, coalesceMs: number): string {
  if (mode === 'coalesce') return `Saves made within ${formatWindow(coalesceMs)} of each other become one commit.`;
  if (mode === 'every-save') return 'Every save is its own commit — a faithful audit trail, and a lot of commits.';
  return 'Saves stay uncommitted until you click Commit. The same message format is used.';
}
