// Pure (DOMAIN-001): the sentences of a run (#305). The failure sentences come from core; these are the run's own.
import { formatMs } from './RunOutcomes.ts';
import type { RunProblem, RunSnapshot } from '../types.ts';

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

const HEADINGS: Record<string, string> = {
  APP_UNREACHABLE: 'Your app is not running',
  PLAYWRIGHT_MISSING: 'Playwright is not installed for this project',
  BROWSERS_MISSING: 'The browser for the tests is not installed',
  TIMEOUT: 'The run took too long and was stopped',
  BAD_BASE_URL: 'That is not an address the tests can use',
};

/** A run that produced no result: a heading that says what to do, and the server's own sentence. */
export function problemView(p: RunProblem): { heading: string; message: string } {
  if (p.state === 'cancelled') return { heading: 'The run was cancelled', message: 'No result was kept from it. Run again when you are ready.' };
  return { heading: HEADINGS[p.code] ?? 'The tests could not run', message: p.message };
}
