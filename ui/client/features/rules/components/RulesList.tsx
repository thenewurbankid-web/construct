import type { RuleRow, RulesViewModel } from '../types';

function countClass(row: RuleRow): string {
  if (row.count === 0) return 'ru-count ru-count--zero';
  return row.severity === 'error' ? 'ru-count ru-count--error' : 'ru-count ru-count--warning';
}

function severityLabel(severity: RuleRow['severity']): string {
  return severity === 'error' ? 'Error' : severity === 'warning' ? 'Warning' : 'Off';
}

/** Every rule for this project, one row per id: severity, live violation count, and the plain-words "why". Presentation
 * only, read-only for this slice (#781) -- editing severity/exceptions/presets is a later slice (#395). */
export function RulesList({ view, onRun }: { view: RulesViewModel; onRun: () => void }) {
  const toolbar = (
    <div className="ru-bar">
      <span className="ru-summary" aria-live="polite" data-testid="rules-summary">
        {view.summary}
      </span>
      <button type="button" className="dg-btn" data-testid="rules-run" onClick={onRun} disabled={view.running}>
        {view.running ? 'Reading...' : 'Refresh'}
      </button>
    </div>
  );

  if (view.mode === 'error') {
    return (
      <div className="ru-browser" data-testid="rules-list">
        {toolbar}
        <div className="ru-empty" role="alert" data-testid="rules-error">
          <p className="ru-empty-title">Rules could not be read</p>
          <p className="hint">{view.error}</p>
        </div>
      </div>
    );
  }
  if (view.mode === 'empty') {
    return (
      <div className="ru-browser" data-testid="rules-list">
        {toolbar}
        <div className="ru-empty" data-testid="rules-empty">
          <p className="ru-empty-title">No rules configured</p>
          <p className="hint">This project&apos;s architecture.yml has no rules to show.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="ru-browser" data-testid="rules-list">
      {toolbar}
      {view.error && (
        <p className="dg-note" role="alert">
          Last read failed: {view.error} Showing the previous result.
        </p>
      )}
      <ul className="ru-list" aria-label="Rules">
        {view.rows.map((row) => (
          <li key={row.id} className="ru-row" data-testid="rule-row" data-rule={row.id}>
            <div className="ru-head">
              <p className="ru-id">{row.id}</p>
              <p className="ru-name">{row.name}</p>
              <div className="ru-chips">
                <span className={`ru-sev ru-sev--${row.severity}`} data-testid="rule-severity">
                  {severityLabel(row.severity)}
                </span>
                <span className={countClass(row)} data-testid="rule-count">
                  {row.count}
                </span>
              </div>
            </div>
            <p className="ru-why" data-testid="rule-why">
              {row.why}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
