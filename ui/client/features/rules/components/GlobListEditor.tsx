'use client';

import { useState } from 'react';
import type { GlobListApi } from '../types';

/** One glob list (nonLayer or frozen) with Remove per entry and an Add form -- #395 slice D. Every add/remove
 * is a reviewable diff (`list.edit`) with Save/Cancel, same shape as the severity and exceptions editors. */
export function GlobListEditor({ title, testId, list }: { title: string; testId: string; list: GlobListApi }) {
  const [draft, setDraft] = useState('');
  const { state, edit } = list;

  return (
    <div className="ru-globs" data-testid={testId}>
      <h4 className="ru-globs-title">{title}</h4>
      {state.status === 'error' && (
        <p className="ru-edit-error" role="alert" data-testid={`${testId}-error`}>
          {state.error}
        </p>
      )}
      {state.rows.length === 0 && state.status === 'ready' && <p className="hint">None configured.</p>}
      <ul className="ru-globs-list" aria-label={title}>
        {state.rows.map((glob, index) => (
          <li key={`${glob}-${index}`} className="ru-glob-row" data-testid={`${testId}-row`}>
            <code className="ru-glob-text">{glob}</code>
            <button type="button" className="dg-btn" data-testid={`${testId}-remove`} onClick={() => list.removeAt(index)}>
              Remove
            </button>
          </li>
        ))}
      </ul>

      {edit ? (
        <div className="ru-edit" data-testid={`${testId}-edit`}>
          {edit.status === 'previewing' && <p className="hint">Previewing...</p>}
          {(edit.status === 'ready' || edit.status === 'saving') && (
            <>
              <pre className="ru-diff" data-testid={`${testId}-edit-diff`}>
                <span className="ru-diff-before">- {edit.before || '(empty architecture.yml)'}</span>
                <span className="ru-diff-after">+ {edit.after}</span>
              </pre>
              <div className="ru-edit-actions">
                <button
                  type="button"
                  className="dg-btn dg-btn--primary"
                  data-testid={`${testId}-edit-save`}
                  onClick={() => {
                    list.confirm();
                    if (edit.kind === 'add') setDraft('');
                  }}
                  disabled={edit.status === 'saving'}
                >
                  {edit.status === 'saving' ? 'Saving...' : 'Save'}
                </button>
                <button type="button" className="dg-btn" data-testid={`${testId}-edit-cancel`} onClick={list.cancel} disabled={edit.status === 'saving'}>
                  Cancel
                </button>
              </div>
            </>
          )}
          {edit.status === 'error' && (
            <>
              <p className="ru-edit-error" role="alert" data-testid={`${testId}-edit-error`}>
                {edit.error}
              </p>
              <button type="button" className="dg-btn" data-testid={`${testId}-edit-cancel`} onClick={list.cancel}>
                Cancel
              </button>
            </>
          )}
        </div>
      ) : (
        <form
          className="ru-glob-form"
          data-testid={`${testId}-add-form`}
          onSubmit={(e) => {
            e.preventDefault();
            list.addGlob(draft);
          }}
        >
          <input
            type="text"
            placeholder="glob, e.g. features/*/tests/**"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            data-testid={`${testId}-input`}
            required
          />
          <button type="submit" className="dg-btn" data-testid={`${testId}-add-submit`}>
            Add
          </button>
        </form>
      )}
    </div>
  );
}
