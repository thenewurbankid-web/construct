// Pure (DOMAIN-001): the words a test outcome is drawn with (#305). A symbol always travels with its word.
import type { OutcomeView, RunOutcome, RunSnapshot, RunStatus, TestArea } from '../types.ts';

const VIEWS: Record<RunStatus, OutcomeView> = {
  passed: { symbol: '✓', word: 'Passed', tone: 'ok' },
  failed: { symbol: '✗', word: 'Failed', tone: 'error' },
  'not-run': { symbol: '○', word: 'Not run', tone: 'muted' },
};

export const outcomeView = (status: RunStatus): OutcomeView => VIEWS[status];

/** "412 ms", "5.5 s", "1 min 12 s". */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** The latest outcome of one test file (a generated test, or one of yours), or null when it has not run. */
export const outcomeFor = (snap: RunSnapshot | null, area: TestArea, file: string): RunOutcome | null => snap?.tests.find((t) => t.area === area && t.file === file) ?? null;
