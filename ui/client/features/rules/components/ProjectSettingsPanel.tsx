'use client';

import { useState } from 'react';
import type { ProjectSettingsApi } from '../types';

// packages/core/config.mjs FRAMEWORKS -- kept in sync by hand since the client can't import a server .mjs;
// projectSettingsSave (ui/server/src/rulesApi.mjs) validates against the real list either way.
const FRAMEWORKS = ['nextjs', 'react-spa'];

/** features.root + project.framework (route adapter), the project-wide settings behind #395 slice 5. Same
 * pick -> reviewable diff -> Save/Cancel shape as the severity and glob editors, one field at a time. */
export function ProjectSettingsPanel({ settings }: { settings: ProjectSettingsApi }) {
  const [featuresRootDraft, setFeaturesRootDraft] = useState('');
  const { state, edit } = settings;

  if (state.status === 'error') {
    return (
      <p className="ru-edit-error" role="alert" data-testid="project-settings-error">
        {state.error}
      </p>
    );
  }
  if (!state.value) return null;

  const editingField = edit?.field ?? null;

  return (
    <div className="ru-project-settings" data-testid="project-settings">
      <h4 className="ru-globs-title">Project settings</h4>

      <div className="ru-project-field" data-testid="project-framework">
        <label htmlFor="project-framework-picker">Framework (route adapter)</label>
        {editingField === 'framework' ? null : (
          <select
            id="project-framework-picker"
            className="ru-sev-picker"
            data-testid="project-framework-picker"
            value={state.value.framework}
            onChange={(e) => settings.start('framework', e.target.value)}
          >
            {FRAMEWORKS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="ru-project-field" data-testid="project-features-root">
        <label htmlFor="project-features-root-input">features.root</label>
        {editingField === 'featuresRoot' ? null : (
          <form
            className="ru-glob-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (featuresRootDraft.trim()) settings.start('featuresRoot', featuresRootDraft.trim());
            }}
          >
            <input
              // Remounts (and so re-reads its uncontrolled defaultValue) whenever the fetched value changes --
              // otherwise a save's own refetch would land after this input has already mounted and be silently
              // ignored, leaving the field showing the pre-save text.
              key={state.value.featuresRoot}
              id="project-features-root-input"
              type="text"
              defaultValue={state.value.featuresRoot}
              onChange={(e) => setFeaturesRootDraft(e.target.value)}
              data-testid="project-features-root-input"
              required
            />
            <button type="submit" className="dg-btn" data-testid="project-features-root-submit">
              Change
            </button>
          </form>
        )}
      </div>

      {edit && (
        <div className="ru-edit" data-testid="project-settings-edit">
          {edit.status === 'previewing' && <p className="hint">Previewing...</p>}
          {(edit.status === 'ready' || edit.status === 'saving') && (
            <>
              <pre className="ru-diff" data-testid="project-settings-edit-diff">
                <span className="ru-diff-before">- {edit.before || '(empty architecture.yml)'}</span>
                <span className="ru-diff-after">+ {edit.after}</span>
              </pre>
              <div className="ru-edit-actions">
                <button
                  type="button"
                  className="dg-btn dg-btn--primary"
                  data-testid="project-settings-edit-save"
                  onClick={settings.confirm}
                  disabled={edit.status === 'saving'}
                >
                  {edit.status === 'saving' ? 'Saving...' : 'Save'}
                </button>
                <button type="button" className="dg-btn" data-testid="project-settings-edit-cancel" onClick={settings.cancel} disabled={edit.status === 'saving'}>
                  Cancel
                </button>
              </div>
            </>
          )}
          {edit.status === 'error' && (
            <>
              <p className="ru-edit-error" role="alert" data-testid="project-settings-edit-error">
                {edit.error}
              </p>
              <button type="button" className="dg-btn" data-testid="project-settings-edit-cancel" onClick={settings.cancel}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
