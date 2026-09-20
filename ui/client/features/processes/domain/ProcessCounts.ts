// Pure (DOMAIN-001): the numbers the top-bar pill and the list show.
import type { ProcessSummary } from '../types.ts';

/** How many processes are running right now; the top-bar pill's number. */
export function runningCount(summaries: ProcessSummary[]): number {
  return summaries.filter((s) => s.state === 'running').length;
}

/** "2 of 5 steps" for a row; a failed step is named because it changes what to do next. */
export function progressText(progress: ProcessSummary['progress']): string {
  const base = `${progress.done} of ${progress.total} ${progress.total === 1 ? 'step' : 'steps'}`;
  return progress.failed ? `${base}, ${progress.failed} failed` : base;
}

/** 0-100, rounded down so a bar never claims completion early. */
export function progressPercent(progress: ProcessSummary['progress']): number {
  if (progress.total <= 0) return 0;
  return Math.floor((progress.done / progress.total) * 100);
}
