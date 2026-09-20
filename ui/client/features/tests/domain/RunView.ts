// Pure (DOMAIN-001): what the run panel, a test's detail and the coverage table draw from a run snapshot (#305), as
// plain text and flags, so the components stay presentation-only.
import { formatMs, outcomeFor, outcomeView } from './RunOutcomes.ts';
import { liveText, problemView, runSummary } from './RunText.ts';
import type { ResultMark, RunOutcome, RunPanelView, RunSnapshot, TestArea, TestRunView } from '../types.ts';

const NOT_RUN: ResultMark = { status: 'none', symbol: '', word: 'Not run', tone: 'muted' };
const markOf = (o: RunOutcome | null): ResultMark => (o ? { status: o.status, ...outcomeView(o.status) } : NOT_RUN);
const detailOf = (o: RunOutcome): string => (o.status === 'not-run' ? (o.reason ? `needs ${o.reason}` : 'skipped') : formatMs(o.durationMs));

/** The result of one generated test's file, for the coverage table's "Last result" column. */
export const resultCell = (snap: RunSnapshot | null, area: TestArea, file: string): ResultMark => markOf(outcomeFor(snap, area, file));

/** The run panel: live status, a problem, the last run's summary, each test's row and the failures to explain. */
export function runPanelView(snap: RunSnapshot | null, feature: string): RunPanelView {
  const live = snap?.live ?? null;
  const problem = !live && snap?.problem ? { ...problemView(snap.problem), code: snap.problem.code } : null;
  const tests = snap?.tests ?? [];
  const done = !live && !problem && snap?.lastRun && tests.length > 0 ? `Last run: ${runSummary(snap)} against ${snap.lastRun.baseUrl}.` : null;
  const rows = live ? [] : tests.map((t) => ({ key: `${t.area}/${t.file}/${t.title}`, area: t.area, file: t.file, title: t.title, mark: markOf(t), detail: detailOf(t) }));
  return { busy: !!live, live: live ? { state: live.state, text: liveText(snap, feature) } : null, problem, done, rows, failures: live ? [] : tests.filter((t) => t.status === 'failed') };
}

/** One test's last run, for its detail; null when it has not run. */
export function testRunView(snap: RunSnapshot | null, area: TestArea, file: string): TestRunView | null {
  const outcome = outcomeFor(snap, area, file);
  return outcome ? { mark: markOf(outcome), detail: detailOf(outcome), outcome } : null;
}
