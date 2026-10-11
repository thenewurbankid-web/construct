import { useId } from 'react';
import type { TraceView } from '../types';

const speedOption = (s: { value: number; label: string }) => (
  <option key={s.value} value={s.value}>
    {s.label}
  </option>
);

/** Start a run; let Auto approve in this session (off until the person turns it on); the speed. */
function AutoStart({ view }: { view: TraceView }) {
  const speedId = useId();
  const { settings } = view;
  return (
    <span className="ltr-row">
      <button type="button" className="ltr-btn ltr-btn--primary" onClick={view.run} disabled={!view.canRun} data-testid="auto-run">
        {view.runLabel}
      </button>
      <label className="ltr-check">
        <input type="checkbox" checked={settings.autoApprove} onChange={(e) => view.setAutoApprove(e.target.checked)} data-testid="auto-approve" />
        Let Auto approve in this session
      </label>
      <label className="ltr-check" htmlFor={speedId}>
        Speed
      </label>
      <select id={speedId} value={settings.speed} onChange={(e) => view.setSpeed(Number(e.target.value))} data-testid="auto-speed">
        {view.speeds.map(speedOption)}
      </select>
    </span>
  );
}

/** The run's caption and its buttons (Pause, Go on, One step, Stop). */
function AutoRunState({ view }: { view: TraceView }) {
  const run = view.settings.run;
  if (!run) return null;
  const button = (b: TraceView['buttons'][number]) => (
    <button key={b.id} type="button" className="ltr-btn" onClick={() => view.press(b.id)} data-testid={`auto-${b.id}`}>
      {b.label}
    </button>
  );
  return (
    <div className="ltr-run" data-testid="auto-run-state" data-status={run.status}>
      <p className="ltr-caption" role="status" data-testid="auto-caption">
        {run.caption}
      </p>
      <span className="ltr-row">{view.buttons.map(button)}</span>
    </div>
  );
}

/** Earlier runs of this tab, each with Replay (it only shows the moves again). */
function AutoHistory({ view }: { view: TraceView }) {
  const { history } = view.settings;
  if (!history.length) return null;
  const row = (h: TraceView['settings']['history'][number]) => (
    <li key={h.id}>
      <span>{h.request}</span>
      <button type="button" className="ltr-btn" onClick={() => view.replay(h.id)} disabled={view.active} aria-label={`Replay: ${h.request}`}>
        Replay
      </button>
    </li>
  );
  return (
    <details className="ltr-tech" data-testid="auto-history">
      <summary>Earlier runs</summary>
      <ul className="ltr-history">{history.map(row)}</ul>
    </details>
  );
}

/** Auto: run the request's steps on the real controls; pause, one step, speed, stop; replay an earlier run. Approve
 * stays the person's unless they let Auto approve in this session. Nothing while Auto is off. */
export function AutoControls({ view }: { view: TraceView }) {
  if (!view.settings.auto) return null;
  return (
    <div className="ltr-auto" data-testid="auto-controls">
      <AutoStart view={view} />
      <AutoRunState view={view} />
      <AutoHistory view={view} />
    </div>
  );
}
