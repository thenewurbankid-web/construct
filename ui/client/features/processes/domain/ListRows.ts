// Pure (DOMAIN-001): the process list in display form.
import type { ListRow, ProcessSummary } from '../types.ts';
import { progressPercent, progressText } from './ProcessCounts.ts';
import { STATE_LABEL } from './StateLabels.ts';

/** Pause/cancel asked for, not yet honoured: the machine is still `running`.
 * The record can keep `pendingControl` after it has settled, so only a running process counts. */
export function pendingNote(summary: ProcessSummary): string | null {
  if (summary.state !== 'running') return null;
  if (summary.pendingControl === 'pause') return 'Pausing after the current step';
  if (summary.pendingControl === 'cancel') return 'Cancelling';
  return null;
}

export function buildListRows(summaries: ProcessSummary[], selectedId: string | null): ListRow[] {
  return summaries.map((s) => ({
    id: s.id,
    title: s.title,
    state: s.state,
    stateLabel: STATE_LABEL[s.state],
    progress: progressText(s.progress),
    percent: progressPercent(s.progress),
    selected: s.id === selectedId,
    note: pendingNote(s),
  }));
}
