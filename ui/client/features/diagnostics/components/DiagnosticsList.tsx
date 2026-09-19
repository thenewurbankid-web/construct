import { useState } from 'react';
import type { DiagnosticsViewProps } from '../types';

/** Validation results in plain language: a summary line, then one row per
 * problem (severity, rule, message, file:line). A row for a page file opens it
 * in the Pages editor; any other row expands to say why and how to fix it. */
export function DiagnosticsList({ view, onRun, onOpenPage }: DiagnosticsViewProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const toolbar = (
    <div className="dg-bar">
      <span className="dg-headline" aria-live="polite">
        {view.summary}
      </span>
      {view.duration && <span className="dg-meta">{view.duration}</span>}
      <span className="sh-spacer" />
      <button type="button" className="dg-btn" data-testid="diagnostics-run" onClick={onRun} disabled={view.running}>
        {view.running ? 'Running...' : 'Run validate'}
      </button>
    </div>
  );

  if (view.mode === 'error') {
    return (
      <div className="dg-root">
        {toolbar}
        <div className="dg-empty" role="alert" data-testid="diagnostics-error">
          <p className="dg-empty-title">Validation could not run</p>
          <p className="hint">{view.error}</p>
        </div>
      </div>
    );
  }
  if (view.mode === 'clean') {
    return (
      <div className="dg-root">
        {toolbar}
        <div className="dg-empty" data-testid="diagnostics-clean">
          <p className="dg-empty-title">No problems found</p>
          <p className="hint">The project follows every architecture rule Construct checks.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="dg-root">
      {toolbar}
      {view.error && (
        <p className="dg-note" role="alert">
          Last run failed: {view.error} Showing the previous result.
        </p>
      )}
      <ul className="dg-list" aria-label="Problems">
        {view.rows.map((row) => {
          const open = expanded === row.key;
          return (
            <li key={row.key} className="dg-item">
              <button
                type="button"
                className="dg-row"
                data-testid="diagnostic-row"
                data-page={row.target ? 'true' : 'false'}
                aria-expanded={row.target ? undefined : open}
                aria-label={row.ariaLabel}
                onClick={() => (row.target ? onOpenPage(row.target, row.line) : setExpanded(open ? null : row.key))}
              >
                <span className={`dg-sev dg-sev--${row.severity}`}>{row.severityLabel}</span>
                <span className="dg-rule">{row.rule}</span>
                <span className="dg-msg">{row.message}</span>
                <span className="dg-file">{row.location}</span>
              </button>
              {open && !row.target && (
                <div className="dg-detail">
                  {row.why && <p><strong>Why:</strong> {row.why}</p>}
                  {row.fix && <p><strong>Fix:</strong> {row.fix}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
