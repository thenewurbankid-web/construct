import { liveText, outcomeView, problemView, formatMs, runSummary } from '../domain/Runs';
import type { RunLive, RunSnapshot, TestArea } from '../types';
import { RunFailure } from './RunFailure';

export type RunPanelProps = {
  feature: string;
  snap: RunSnapshot | null;
  live: RunLive | null;
  address: string;
  refused: string | null;
  copied: string | null;
  canRun: boolean;
  onAddress: (value: string) => void;
  onRunAll: () => void;
  onCancel: () => void;
  onCopy: (key: string, text: string) => Promise<boolean>;
  onOpenTest: (area: TestArea, file: string) => void;
};

/** The run controls and results of the Tests stage (#305): where the app is, Run all tests, the live status with Cancel,
 * a run that could not start (in its own words), and the result of the last run test by test. A run is a Process, so it
 * is also in the Processes drawer; status changes are announced in a live region. */
export function RunPanel(p: RunPanelProps) {
  const busy = !!p.live;
  const problem = !busy && p.snap?.problem ? problemView(p.snap.problem) : null;
  const failed = (p.snap?.tests ?? []).filter((t) => t.status === 'failed');
  return (
    <section className="ts-run" data-testid="run-panel" aria-label="Run the tests">
      <div className="ts-run-bar">
        <label className="ts-run-addr">
          <span className="ts-label">The app runs at</span>
          <input className="ts-input" data-testid="run-address" value={p.address} onChange={(e) => p.onAddress(e.target.value)} spellCheck={false} autoComplete="off" disabled={busy} aria-describedby="run-address-hint" />
        </label>
        {busy ? (
          <button type="button" className="ts-btn" data-testid="run-cancel" onClick={p.onCancel}>Cancel run</button>
        ) : (
          <button type="button" className="ts-btn ts-btn--primary" data-testid="run-all" disabled={!p.canRun} onClick={p.onRunAll}>Run all tests</button>
        )}
      </div>
      <p className="hint" id="run-address-hint">Tests drive your project&apos;s own app, so start it first (for example npm run dev). Only an address on this machine is accepted.</p>
      <div role="status" aria-live="polite" data-testid="run-status">
        {busy && <p className="ts-run-live" data-testid="run-live" data-state={p.live?.state}><span className="ts-run-dot" aria-hidden="true" />{liveText(p.snap, p.feature)}</p>}
        {!busy && p.snap?.lastRun && p.snap.tests.length > 0 && !problem && <p className="hint" data-testid="run-done">Last run: {runSummary(p.snap)} against {p.snap.lastRun.baseUrl}.</p>}
      </div>
      {p.refused && <p className="ts-err" role="alert" data-testid="run-refused">{p.refused}</p>}
      {problem && (
        <div className="ts-banner ts-banner--error" role="alert" data-testid="run-problem" data-code={p.snap?.problem?.code}>
          <h3>{problem.heading}</h3>
          <p>{problem.message}</p>
        </div>
      )}
      {!busy && p.snap && p.snap.tests.length > 0 && (
        <div data-testid="run-results">
          <ul className="ts-results" aria-label="Result of the last run, test by test">
            {p.snap.tests.map((t) => {
              const v = outcomeView(t.status);
              return (
                <li key={`${t.area}/${t.file}/${t.title}`} className={`ts-result ts-result--${v.tone}`} data-testid="run-result" data-status={t.status}>
                  <span className="ts-result-mark"><span aria-hidden="true">{v.symbol} </span>{v.word}</span>
                  <button type="button" className="ts-row-btn ts-result-title" onClick={() => p.onOpenTest(t.area, t.file)} aria-label={`Open ${t.title}`}><span className="ts-cell-clip">{t.title}</span></button>
                  <span className="ts-cell-sub">{t.status === 'not-run' ? (t.reason ? `needs ${t.reason}` : 'skipped') : formatMs(t.durationMs)}</span>
                </li>
              );
            })}
          </ul>
          {failed.map((t) => <RunFailure key={`${t.area}/${t.file}/${t.title}`} outcome={t} copied={p.copied} onCopy={p.onCopy} />)}
        </div>
      )}
    </section>
  );
}
