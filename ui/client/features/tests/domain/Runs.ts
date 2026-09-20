// Pure (DOMAIN-001): the words the Tests screen uses for a run (#305). Every failure sentence comes from core; this only
// pairs a symbol with a word (never colour alone), formats durations and picks the right outcome for a test.
import type { OutcomeView, RunOutcome, RunProblem, RunSnapshot, RunStatus, TestArea } from '../types.ts';

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

/** "5 passed · 1 failed · 2 not run · 12.3 s". */
export function runSummary(snap: RunSnapshot | null): string {
  const r = snap?.lastRun;
  if (!r) return '';
  return `${r.counts.passed} passed · ${r.counts.failed} failed · ${r.counts.notRun} not run · ${formatMs(r.durationMs)}`;
}

/** What the live run is doing, in words a live region can announce. */
export function liveText(snap: RunSnapshot | null, feature: string): string {
  const live = snap?.live;
  if (!live) return '';
  const what = live.target ? live.target.name : `every test of ${feature}`;
  if (live.state === 'queued') return `Waiting to run ${what}. Another process is using the run slot.`;
  if (live.state === 'paused') return `The run of ${what} is paused in the Processes drawer.`;
  return `Running ${what}. Playwright opens the app in a browser, one test at a time.`;
}

/** A run that produced no result: a heading that says what to do, and the server's own sentence. */
export function problemView(p: RunProblem): { heading: string; message: string } {
  if (p.state === 'cancelled') return { heading: 'The run was cancelled', message: 'No result was kept from it. Run again when you are ready.' };
  const headings: Record<string, string> = {
    APP_UNREACHABLE: 'Your app is not running',
    PLAYWRIGHT_MISSING: 'Playwright is not installed for this project',
    BROWSERS_MISSING: 'The browser for the tests is not installed',
    TIMEOUT: 'The run took too long and was stopped',
    BAD_BASE_URL: 'That is not an address the tests can use',
  };
  return { heading: headings[p.code] ?? 'The tests could not run', message: p.message };
}
