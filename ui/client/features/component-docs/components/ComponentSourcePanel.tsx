import { SourceEditor, describeSummary, diagnosticsToMarkers, summarizeDiagnostics, type SourceDiagnostic } from '@/features/pages-editor';
import { WorkflowDiffPreview } from '@/features/workflows';
import { ErrorState } from '@/features/states';
import type { EditState } from '../types';

type Props = {
  path: string;
  state: EditState;
  diagnostics: SourceDiagnostic[];
  loading: boolean;
  loadError: string | null;
  onEdit: (draft: string) => void;
  onReview: () => void;
  onCancelReview: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
  onReload: () => void;
};

/** The file itself, as plain text: the source editor, then Review changes -> Confirm save (the diff comes from the
 * server; nothing is written until it is confirmed). Presentation only. */
export function ComponentSourcePanel({ path, state, diagnostics, loading, loadError, onEdit, onReview, onCancelReview, onConfirm, onDiscard, onReload }: Props) {
  const { loaded, draft, phase } = state;
  if (loadError) return <ErrorState size="inline" title="Could not open the file" hint={loadError} onRetry={onReload} />;
  if (!loaded) return <p className="cd-hint" role="status">{loading ? 'Opening the file…' : ''}</p>;
  const dirty = draft !== loaded.source;
  const busy = phase === 'checking' || phase === 'saving';
  const markers = diagnosticsToMarkers(diagnostics, draft);
  const summary = summarizeDiagnostics(diagnostics);
  return (
    <section className="cd-source" data-testid="cd-source" aria-label="Source">
      <div className="cd-source-head">
        <h3 className="cd-h3">Source</h3>
        <span className={summary.errors ? 'status-error' : 'cd-hint'} data-testid="cd-source-summary">{describeSummary(summary)}</span>
        {!loaded.editable && <span className="cd-hint" data-testid="cd-readonly">Read-only: this file is too large to edit here.</span>}
      </div>
      <SourceEditor value={draft} markers={markers} readOnly={!loaded.editable} onChange={onEdit} label={`Source of ${path}`} />
      {state.error && <p className="status-error" role="alert" data-testid="cd-error">{state.error}</p>}
      {state.saved && <p className="status-ok" role="status" data-testid="cd-saved">Saved. The change was checked against the architecture rules and committed by the normal save path.</p>}
      {phase === 'preview' ? (
        <WorkflowDiffPreview hunks={state.hunks} busy={busy} onConfirm={onConfirm} onCancel={onCancelReview} />
      ) : (
        <div className="cd-actions">
          <button type="button" className="st-btn st-btn--primary" data-testid="cd-review" disabled={!dirty || busy} onClick={onReview}>
            {phase === 'checking' ? 'Checking…' : 'Review changes'}
          </button>
          <button type="button" className="st-btn" data-testid="cd-discard" disabled={!dirty || busy} onClick={onDiscard}>Discard changes</button>
          {state.conflict && <button type="button" className="st-btn" data-testid="cd-reload" onClick={onReload}>Reload from disk</button>}
        </div>
      )}
    </section>
  );
}
