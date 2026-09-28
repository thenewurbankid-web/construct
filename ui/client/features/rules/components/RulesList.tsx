import type { RuleEditApi, RuleRow, RuleSeverity, RulesViewModel } from '../types';

const SEVERITIES: RuleSeverity[] = ['error', 'warning', 'off'];

function countClass(row: RuleRow): string {
  if (row.count === 0) return 'ru-count ru-count--zero';
  return row.severity === 'error' ? 'ru-count ru-count--error' : 'ru-count ru-count--warning';
}

function severityLabel(severity: RuleRow['severity']): string {
  return severity === 'error' ? 'Error' : severity === 'warning' ? 'Warning' : 'Off';
}

/** The row's inline severity picker, or (while a save is in flight for THIS row) its reviewable diff with
 * Save/Cancel -- #395 slice B. Presentation only; every action goes through `edit`. */
function SeverityEditor({ row, edit }: { row: RuleRow; edit: RuleEditApi }) {
  const editing = edit.state?.ruleId === row.id ? edit.state : null;
  if (!editing) {
    return (
      <select
        className="ru-sev-picker"
        data-testid="rule-severity-picker"
        value={row.severity}
        onChange={(e) => edit.start(row.id, e.target.value as RuleSeverity)}
      >
        {SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {severityLabel(s)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="ru-edit" data-testid="rule-edit">
      {editing.status === 'previewing' && <p className="hint">Previewing...</p>}
      {(editing.status === 'ready' || editing.status === 'saving') && (
        <>
          <pre className="ru-diff" data-testid="rule-edit-diff">
            <span className="ru-diff-before">- {editing.before || '(empty architecture.yml)'}</span>
            <span className="ru-diff-after">+ {editing.after}</span>
          </pre>
          <div className="ru-edit-actions">
            <button type="button" className="dg-btn dg-btn--primary" data-testid="rule-edit-save" onClick={edit.confirm} disabled={editing.status === 'saving'}>
              {editing.status === 'saving' ? 'Saving...' : 'Save'}
            </button>
            <button type="button" className="dg-btn" data-testid="rule-edit-cancel" onClick={edit.cancel} disabled={editing.status === 'saving'}>
              Cancel
            </button>
          </div>
        </>
      )}
      {editing.status === 'error' && (
        <>
          <p className="ru-edit-error" role="alert" data-testid="rule-edit-error">
            {editing.error}
          </p>
          <button type="button" className="dg-btn" data-testid="rule-edit-cancel" onClick={edit.cancel}>
            Cancel
          </button>
        </>
      )}
    </div>
  );
}

/** Every rule for this project, one row per id: severity (editable, #395 slice B), live violation count, and the
 * plain-words "why". */
export function RulesList({ view, onRun, edit }: { view: RulesViewModel; onRun: () => void; edit: RuleEditApi }) {
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
            <SeverityEditor row={row} edit={edit} />
          </li>
        ))}
      </ul>
    </div>
  );
}
