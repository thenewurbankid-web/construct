import type { RunPanelProps } from '../types';

/** Where the app runs, Run all tests / Cancel run, and what the run is doing or why it could not start. The status
 * sits in a polite live region, so a screen reader hears queued, running, done and problems as they change. */
export function RunControls(p: RunPanelProps) {
  const { view } = p;
  return (
    <>
      <div className="ts-run-bar">
        <label className="ts-run-addr">
          <span className="ts-label">The app runs at</span>
          <input className="ts-input" data-testid="run-address" value={p.address} onChange={(e) => p.onAddress(e.target.value)} spellCheck={false} autoComplete="off" disabled={view.busy} aria-describedby="run-address-hint" />
        </label>
        {view.busy ? (
          <button type="button" className="ts-btn" data-testid="run-cancel" onClick={p.onCancel}>Cancel run</button>
        ) : (
          <button type="button" className="ts-btn ts-btn--primary" data-testid="run-all" disabled={!p.canRun} onClick={p.onRunAll}>Run all tests</button>
        )}
      </div>
      <p className="hint" id="run-address-hint">Tests drive your project&apos;s own app, so start it first (for example npm run dev). Only an address on this machine is accepted.</p>
      <div role="status" aria-live="polite" data-testid="run-status">
        {view.live && <p className="ts-run-live" data-testid="run-live" data-state={view.live.state}><span className="ts-run-dot" aria-hidden="true" />{view.live.text}</p>}
        {view.done && <p className="hint" data-testid="run-done">{view.done}</p>}
      </div>
      {p.refused && <p className="ts-err" role="alert" data-testid="run-refused">{p.refused}</p>}
      {view.problem && (
        <div className="ts-banner ts-banner--error" role="alert" data-testid="run-problem" data-code={view.problem.code}>
          <h3>{view.problem.heading}</h3>
          <p>{view.problem.message}</p>
        </div>
      )}
    </>
  );
}
