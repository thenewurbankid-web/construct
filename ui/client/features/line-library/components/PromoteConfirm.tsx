import type { ChangeControls } from '../types';

/** "Promote to library", second step: says what will move before anything is written, then Promote or Cancel. */
export function PromoteConfirm({ controls, text }: { controls: ChangeControls; text: string }) {
  const { change } = controls;
  if (change.status !== 'promote' && change.status !== 'promote-saving') return null;
  const saving = change.status === 'promote-saving';
  const error = change.status === 'promote' ? change.error : null;
  return (
    <div className="ll-form" role="group" aria-label={`Promote ${change.name} to the library`} data-testid="ll-promote-confirm">
      <p className="ll-finding">{text}</p>
      {error && (
        <p className="ll-error" role="alert">
          {error}
        </p>
      )}
      <span className="ll-actions">
        <button type="button" className="ll-btn ll-btn--primary" onClick={controls.submit} disabled={saving} data-line-control="components.promoteConfirm" data-line-target={change.name}>
          {saving ? 'Promoting...' : 'Promote'}
        </button>
        <button type="button" className="ll-btn" onClick={controls.cancel} disabled={saving}>
          Cancel
        </button>
      </span>
    </div>
  );
}
