import type { NoteEditorProps } from '../types';
import { ConflictBanner } from './ConflictBanner';
import { SaveIndicator } from './SaveIndicator';
import { StatusTag } from './StatusTag';

/** One note: title, text, the save state, and what to do when saving goes wrong. Nothing typed here is sent to a model. */
export function NoteEditor({ view, onTitle, onBody, onBlur, onRetry, onKeepMine, onLoadTheirs, onToggleCompare, onDuplicate, onConfirmDelete, onDelete }: NoteEditorProps) {
  return (
    <div className="nt-editor" data-testid="note-editor">
      <div className="nt-bar">
        <StatusTag tag={view.tag} />
        {view.ranNote && <span className="nt-ran" data-testid="note-ran">{view.ranNote}</span>}
        <SaveIndicator indicator={view.indicator} />
        <span className="nt-bar-gap" />
        <button type="button" className="nt-btn" data-testid="note-duplicate" onClick={onDuplicate}>{view.readOnly ? 'Duplicate to iterate' : 'Duplicate'}</button>
        {view.confirmingDelete ? (
          <span className="nt-confirm" role="group" aria-label="Confirm delete">
            <span>Delete this note?</span>
            <button type="button" className="nt-btn nt-btn--danger" data-testid="note-delete-confirm" onClick={onDelete}>Delete</button>
            <button type="button" className="nt-btn" onClick={() => onConfirmDelete(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="nt-btn" data-testid="note-delete" onClick={() => onConfirmDelete(true)}>Delete</button>
        )}
      </div>
      {view.conflict && <ConflictBanner conflict={view.conflict} onKeepMine={onKeepMine} onLoadTheirs={onLoadTheirs} onToggleCompare={onToggleCompare} />}
      {view.failed && (
        <section className="nt-banner nt-banner--bad" role="alert" data-testid="note-failed">
          <p>{view.failureHint}</p>
          <div className="nt-actions">
            <button type="button" className="nt-btn nt-btn--primary" data-testid="note-retry" onClick={onRetry}>Retry</button>
          </div>
        </section>
      )}
      <label className="nt-field">
        <span className="nt-sr">Note title</span>
        <input type="text" className="nt-title" value={view.title} readOnly={view.readOnly} onChange={(e) => onTitle(e.target.value)} onBlur={onBlur} placeholder="A short title" data-testid="note-title" />
      </label>
      <label className="nt-field nt-field--grow">
        <span className="nt-sr">Note text</span>
        <textarea className="nt-body" value={view.body} readOnly={view.readOnly} onChange={(e) => onBody(e.target.value)} onBlur={onBlur} placeholder="Describe the change you want, in your own words. It saves as you go." data-testid="note-body" />
      </label>
      <p className="hint">Saved on this machine, outside your project. Never committed, and no model reads it unless you run a plan step tagged Local model.</p>
    </div>
  );
}
