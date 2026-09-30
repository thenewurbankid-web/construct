'use client';

import { useState } from 'react';
import type { ExceptionsApi, NewException, RuleRow } from '../types';

const EMPTY_DRAFT: NewException = { path: '', rule: '', expires: '', reason: '' };

/** #395 slice C -- every exception in this project's architecture.yml, with Remove per row and an Add form
 * (path glob, rule, optional expires/reason). Every add/remove is a reviewable diff (`exceptions.edit`) with
 * Save/Cancel, same shape as the severity editor above it. */
export function ExceptionsPanel({ exceptions, rules }: { exceptions: ExceptionsApi; rules: RuleRow[] }) {
  const [draft, setDraft] = useState<NewException>(EMPTY_DRAFT);
  const { state, edit } = exceptions;

  return (
    <section className="ru-exceptions" data-testid="exceptions-panel">
      <h3 className="ru-exceptions-title">Exceptions</h3>
      {state.status === 'error' && (
        <p className="ru-edit-error" role="alert" data-testid="exceptions-error">
          {state.error}
        </p>
      )}
      {state.rows.length === 0 && state.status === 'ready' && <p className="hint">No exceptions configured.</p>}
      <ul className="ru-exceptions-list" aria-label="Exceptions">
        {state.rows.map((row) => (
          <li key={row.index} className="ru-exception-row" data-testid="exception-row">
            <div className="ru-exception-head">
              <p className="ru-exception-path">{row.path}</p>
              <p className="ru-exception-rules">{row.rules.join(', ')}</p>
              {row.expires && (
                <span className={row.expired ? 'ru-exception-expires ru-exception-expires--expired' : 'ru-exception-expires'} data-testid="exception-expires">
                  {row.expired ? 'Expired ' : 'Expires '}
                  {row.expires}
                </span>
              )}
              <button type="button" className="dg-btn" data-testid="exception-remove" onClick={() => exceptions.removeAt(row.index)}>
                Remove
              </button>
            </div>
            {row.reason && <p className="ru-exception-reason">{row.reason}</p>}
          </li>
        ))}
      </ul>

      {edit ? (
        <div className="ru-edit" data-testid="exception-edit">
          {edit.status === 'previewing' && <p className="hint">Previewing...</p>}
          {(edit.status === 'ready' || edit.status === 'saving') && (
            <>
              <pre className="ru-diff" data-testid="exception-edit-diff">
                <span className="ru-diff-before">- {edit.before || '(empty architecture.yml)'}</span>
                <span className="ru-diff-after">+ {edit.after}</span>
              </pre>
              <div className="ru-edit-actions">
                <button
                  type="button"
                  className="dg-btn dg-btn--primary"
                  data-testid="exception-edit-save"
                  onClick={() => {
                    exceptions.confirm();
                    if (edit.kind === 'add') setDraft(EMPTY_DRAFT);
                  }}
                  disabled={edit.status === 'saving'}
                >
                  {edit.status === 'saving' ? 'Saving...' : 'Save'}
                </button>
                <button type="button" className="dg-btn" data-testid="exception-edit-cancel" onClick={exceptions.cancel} disabled={edit.status === 'saving'}>
                  Cancel
                </button>
              </div>
            </>
          )}
          {edit.status === 'error' && (
            <>
              <p className="ru-edit-error" role="alert" data-testid="exception-edit-error">
                {edit.error}
              </p>
              <button type="button" className="dg-btn" data-testid="exception-edit-cancel" onClick={exceptions.cancel}>
                Cancel
              </button>
            </>
          )}
        </div>
      ) : (
        <form
          className="ru-exception-form"
          data-testid="exception-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            exceptions.addDraft(draft);
          }}
        >
          <input
            type="text"
            placeholder="path glob, e.g. features/legacy/**"
            value={draft.path}
            onChange={(e) => setDraft({ ...draft, path: e.target.value })}
            data-testid="exception-path-input"
            required
          />
          <select value={draft.rule} onChange={(e) => setDraft({ ...draft, rule: e.target.value })} data-testid="exception-rule-select" aria-label="Rule" required>
            <option value="" disabled>
              Rule...
            </option>
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id}
              </option>
            ))}
          </select>
          <input type="date" aria-label="Expires" value={draft.expires} onChange={(e) => setDraft({ ...draft, expires: e.target.value })} data-testid="exception-expires-input" />
          <input
            type="text"
            placeholder="reason (optional)"
            value={draft.reason}
            onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            data-testid="exception-reason-input"
          />
          <button type="submit" className="dg-btn" data-testid="exception-add-submit">
            Add exception
          </button>
        </form>
      )}
    </section>
  );
}
