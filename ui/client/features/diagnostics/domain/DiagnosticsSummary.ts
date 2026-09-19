// Pure (DOMAIN-001): the short texts and counts derived from a validate run.
import type { DiagnosticsState, SeverityCounts } from '../types.ts';

/** "3 errors, 2 warnings" or "No problems found". */
export function headline(counts: SeverityCounts): string {
  if (counts.total === 0) return 'No problems found';
  const parts: string[] = [];
  if (counts.error) parts.push(`${counts.error} ${counts.error === 1 ? 'error' : 'errors'}`);
  if (counts.warning) parts.push(`${counts.warning} ${counts.warning === 1 ? 'warning' : 'warnings'}`);
  if (counts.info) parts.push(`${counts.info} ${counts.info === 1 ? 'note' : 'notes'}`);
  return parts.join(', ');
}

/** The count shown as the tab badge: nothing until a run has finished; 0 is shown (it is a result). */
export function tabBadge(state: DiagnosticsState): number | undefined {
  return state.status === 'ready' ? state.total : undefined;
}

/** Short status-bar text. */
export function statusText(state: DiagnosticsState): string {
  if (state.status === 'running') return 'validate: checking';
  if (state.status === 'error') return 'validate: could not run';
  if (state.status === 'idle') return 'validate: not run yet';
  return state.total === 0 ? 'validate: no problems' : `validate: ${state.total} ${state.total === 1 ? 'problem' : 'problems'}`;
}
