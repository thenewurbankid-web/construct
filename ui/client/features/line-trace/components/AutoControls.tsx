import { useId } from 'react';
import { SPEEDS, isActive } from '../domain/AutoRun';
import type { TraceView } from '../types';

/** Auto: run the request's steps on the real controls; pause, one step, speed, stop; replay an earlier run (a replay
 * only shows the moves). Approve stays the person's unless they let Auto approve in this session. */
export function AutoControls({ view }: { view: TraceView }) {
  const speedId = useId();
  const { settings, match } = view;
  const run = settings.run;
  const active = isActive(run);
  const script = match?.tools[0]?.from === 'request' ? match.tools[0].script : [];
  return (
    <div className="ltr-auto" data-testid="auto-controls">
      <span className="ltr-row">
        <button type="button" className="ltr-btn ltr-btn--primary" onClick={view.run} disabled={active || !script.length} data-testid="auto-run">
          {settings.trace ? 'Show me and do it' : 'Do it'}
        </button>
        <label className="ltr-check">
          <input type="checkbox" checked={settings.autoApprove} onChange={(e) => view.setAutoApprove(e.target.checked)} data-testid="auto-approve" />
          Let Auto approve in this session
        </label>
        <label className="ltr-check" htmlFor={speedId}>
          Speed
        </label>
        <select id={speedId} value={settings.speed} onChange={(e) => view.setSpeed(Number(e.target.value))} data-testid="auto-speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s === 1 ? 'Normal' : s < 1 ? 'Slow' : 'Fast'}
            </option>
          ))}
        </select>
      </span>
      {run && (
        <div className="ltr-run" data-testid="auto-run-state" data-status={run.status}>
          <p className="ltr-caption" role="status" data-testid="auto-caption">
            {run.caption}
          </p>
          {active && (
            <span className="ltr-row">
              {run.status === 'playing' && (
                <button type="button" className="ltr-btn" onClick={view.pause} data-testid="auto-pause">
                  Pause
                </button>
              )}
              {run.status === 'paused' && (
                <>
                  <button type="button" className="ltr-btn" onClick={view.resume} data-testid="auto-resume">
                    Go on
                  </button>
                  <button type="button" className="ltr-btn" onClick={view.step} data-testid="auto-step">
                    One step
                  </button>
                </>
              )}
              <button type="button" className="ltr-btn" onClick={view.stop} data-testid="auto-stop">
                Stop
              </button>
            </span>
          )}
        </div>
      )}
      {settings.history.length > 0 && (
        <details className="ltr-tech" data-testid="auto-history">
          <summary>Earlier runs</summary>
          <ul className="ltr-history">
            {settings.history.map((h) => (
              <li key={h.id}>
                <span>{h.request}</span>
                <button type="button" className="ltr-btn" onClick={() => view.replay(h.id)} disabled={active} aria-label={`Replay: ${h.request}`}>
                  Replay
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
