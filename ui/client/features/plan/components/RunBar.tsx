import type { RunBarProps } from '../types';

/** Run plan. It is off until the whole plan is valid, says where a model will be used BEFORE it runs, and once
 * started points at the Processes drawer, where the work is watched and approved. */
export function RunBar({ modelNotice, blocked, canRun, runStatus, runError, started, onRun, onOpenProcesses }: RunBarProps) {
  return (
    <div className="pl-run">
      {modelNotice && (
        <p className="pl-hint" data-testid="plan-model-notice">
          <span className="pl-badge pl-badge--model">Local model</span> {modelNotice}
        </p>
      )}
      {blocked && <p className="pl-hint" data-testid="plan-run-blocked">{blocked}</p>}
      {runError && <p className="pl-err" role="alert" data-testid="plan-run-error">{runError}</p>}
      {started && (
        <p className="pl-ok" role="status" data-testid="plan-started">
          Started. Watch it and approve its changes in the Processes drawer.{' '}
          <button type="button" className="dg-btn" onClick={onOpenProcesses} data-testid="plan-open-processes">Open Processes</button>
        </p>
      )}
      <button type="button" className="dg-btn pl-primary" disabled={!canRun} onClick={onRun} data-testid="plan-run">
        {runStatus === 'loading' ? 'Starting...' : 'Run plan'}
      </button>
      <p className="pl-hint">One bot at a time, in its own branch. Nothing reaches your project until you approve it.</p>
    </div>
  );
}
