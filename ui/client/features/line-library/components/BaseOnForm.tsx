import type { FormEvent } from 'react';
import type { ChangeControls } from '../types';

/** "Base on this": pick the feature and the new item's name, then Create. Nothing is written until Create; a
 * refusal comes back as one sentence and the form stays open. */
export function BaseOnForm({ controls, libraryName }: { controls: ChangeControls; libraryName: string }) {
  const { change } = controls;
  if (change.status !== 'base-on' && change.status !== 'base-on-saving') return null;
  const saving = change.status === 'base-on-saving';
  const error = change.status === 'base-on' ? change.error : null;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    controls.submit();
  };
  return (
    <form className="ll-form" aria-label={`Base a new component on ${libraryName}`} onSubmit={onSubmit} data-testid="ll-base-on-form">
      <label className="ll-field">
        <span>Feature</span>
        <select data-line-control="components.baseOnFeature" data-line-target={libraryName} value={change.feature} onChange={(e) => controls.setFeature(e.target.value)} disabled={saving}>
          {controls.features.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label className="ll-field">
        <span>Name</span>
        <input data-line-control="components.baseOnName" data-line-target={libraryName} value={change.name} onChange={(e) => controls.setName(e.target.value)} disabled={saving} spellCheck={false} />
      </label>
      {error && (
        <p className="ll-error" role="alert">
          {error}
        </p>
      )}
      <span className="ll-actions">
        <button type="submit" className="ll-btn ll-btn--primary" disabled={saving} data-line-control="components.baseOnCreate" data-line-target={libraryName}>
          {saving ? 'Creating...' : 'Create'}
        </button>
        <button type="button" className="ll-btn" onClick={controls.cancel} disabled={saving}>
          Cancel
        </button>
      </span>
    </form>
  );
}
