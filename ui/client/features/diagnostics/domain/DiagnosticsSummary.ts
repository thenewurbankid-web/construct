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

/** The count shown as the tab badge.
 *
 * `null` -- "there is a badge here, it has no value yet" -- until a run has
 * actually finished, which reserves its room in the tab so the first result
 * cannot shove the tabs beside it sideways (#252). `durationMs` is the test for
 * that: it is how long the last completed run took, so it is null exactly while
 * no run has ever completed.
 *
 * From then on it is the last known count, *including while a re-run is in
 * flight*. The reducer deliberately keeps the previous result visible during a
 * re-run; blanking the badge contradicted that and made every re-run bounce the
 * tabs left and then right again. 0 is shown -- it is a result. */
export function tabBadge(state: DiagnosticsState): number | null {
  return state.durationMs === null ? null : state.total;
}

/** Short status-bar text. */
export function statusText(state: DiagnosticsState): string {
  if (state.status === 'running') return 'validate: checking';
  if (state.status === 'error') return 'validate: could not run';
  if (state.status === 'idle') return 'validate: not run yet';
  return state.total === 0 ? 'validate: no problems' : `validate: ${state.total} ${state.total === 1 ? 'problem' : 'problems'}`;
}

// Every text statusText can produce. The status bar reserves room for the
// longest of them up front, so a background result changing what the readout
// says cannot change how much room it takes (#252) -- the readout is itself a
// button, so resizing it moves its own hit area under the pointer.
//
// Derived by running statusText over each state rather than hand-listing the
// strings, so it cannot drift from the function it is measuring.
const BLANK = { violations: [], truncated: false, error: null };
const GAUGE_STATES: DiagnosticsState[] = [
  { ...BLANK, status: 'idle', total: 0, durationMs: null },
  { ...BLANK, status: 'running', total: 0, durationMs: null },
  { ...BLANK, status: 'error', total: 0, durationMs: null },
  { ...BLANK, status: 'ready', total: 0, durationMs: 1 },
  { ...BLANK, status: 'ready', total: 1, durationMs: 1 },
  // Three digits: the widest count a real project reaches. More than that is
  // not clipped, it simply grows the readout -- see the issue's exceptions.
  { ...BLANK, status: 'ready', total: 888, durationMs: 1 },
];

export function statusTexts(): string[] {
  return GAUGE_STATES.map(statusText);
}

/** The longest statusText, in characters -- what the status bar reserves (#252).
 * Characters, not pixels: the status bar sizes itself in `ch`, so the reservation
 * follows the font and the zoom, and nothing has to be measured in a layout pass
 * or duplicated invisibly into the DOM. */
export function statusTextChars(): number {
  return Math.max(...statusTexts().map((t) => t.length));
}
