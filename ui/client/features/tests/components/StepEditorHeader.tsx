import type { StepEditorState } from '../types';

type Editing = Extract<StepEditorState, { status: 'editing' }>;

/** The document's title, where it lives, how many changes are unsaved, and the "saved" notice. */
export function StepEditorHeader({ state, changes }: { state: Editing; changes: number }) {
  return (
    <>
      <header className="ts-editor-head">
        <h2 className="ts-editor-title" data-testid="editor-title">{state.title}</h2>
        <p className="ts-path" data-testid="editor-path">{state.path}</p>
        <span className="ts-chip ts-chip--yours">Yours</span>
        <span className={`ts-chip ${changes ? 'ts-chip--stale' : 'ts-chip--none'}`} data-testid="editor-changes">{changes ? `${changes} unsaved change${changes === 1 ? '' : 's'}` : 'No unsaved changes'}</span>
      </header>
      {state.notice && <div className="ts-banner ts-banner--ok" role="status" data-testid="editor-notice"><p>{state.notice}</p></div>}
    </>
  );
}
