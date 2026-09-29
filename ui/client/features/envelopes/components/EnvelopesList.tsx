import type { EnvelopesViewModel } from '../types';

/** Every saved flow for this project, one row per name with its step count -- #395/#771's left panel. `onLoad`
 * (when given) sends a flow's steps to the compose center stage as its starting draft; save/run stays out of
 * scope (#772). */
export function EnvelopesList({ view, onRun, onLoad }: { view: EnvelopesViewModel; onRun: () => void; onLoad?: (name: string) => void }) {
  const toolbar = (
    <div className="ev-bar">
      <span className="ev-summary" aria-live="polite" data-testid="envelopes-summary">
        {view.summary}
      </span>
      <button type="button" className="dg-btn" data-testid="envelopes-run" onClick={onRun} disabled={view.running}>
        {view.running ? 'Reading...' : 'Refresh'}
      </button>
    </div>
  );

  if (view.mode === 'error') {
    return (
      <div className="ev-browser" data-testid="envelopes-list">
        {toolbar}
        <div className="ev-empty" role="alert" data-testid="envelopes-error">
          <p className="ev-empty-title">Saved flows could not be read</p>
          <p className="hint">{view.error}</p>
        </div>
      </div>
    );
  }
  if (view.mode === 'empty') {
    return (
      <div className="ev-browser" data-testid="envelopes-list">
        {toolbar}
        <div className="ev-empty" data-testid="envelopes-empty">
          <p className="ev-empty-title">No flows saved yet</p>
          <p className="hint">Save one with `construct pipeline save &lt;name&gt;`, or from the composer once it can save (#772).</p>
        </div>
      </div>
    );
  }
  return (
    <div className="ev-browser" data-testid="envelopes-list">
      {toolbar}
      {view.error && (
        <p className="dg-note" role="alert">
          Last read failed: {view.error} Showing the previous result.
        </p>
      )}
      <ul className="ev-list" aria-label="Saved flows">
        {view.rows.map((row) => (
          <li key={row.name} className="ev-row" data-testid="envelope-row" data-flow={row.name}>
            <p className="ev-name">{row.name}</p>
            {row.error ? (
              <p className="ev-row-error" data-testid="envelope-row-error">
                {row.error}
              </p>
            ) : (
              <>
                <span className="ev-count" data-testid="envelope-step-count">
                  {row.stepCount} step{row.stepCount === 1 ? '' : 's'}
                </span>
                {onLoad && (
                  <button type="button" className="dg-btn" data-testid="envelope-row-load" onClick={() => onLoad(row.name)}>
                    Load
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
