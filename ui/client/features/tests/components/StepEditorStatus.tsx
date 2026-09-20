import type { StepEditorState } from '../types';

/** Loading, error and read-only (with the reason) states of the editor. Read-only is a feature, not a failure:
 * a file that would not survive parse -> render is never offered for editing, so it can never be corrupted. */
export function StepEditorStatus({ state }: { state: StepEditorState }) {
  if (state.status === 'loading') return <p className="hint" role="status">Opening the test...</p>;
  if (state.status === 'error') return <div className="ts-banner ts-banner--error" role="alert" data-testid="editor-error"><h3>The test could not be opened</h3><p>{state.message}</p></div>;
  if (state.status !== 'readonly') return null;
  return (
    <div className="ts-banner ts-banner--warn" data-testid="editor-readonly">
      <h3>Shown read-only: this file is not in the shape the step editor writes</h3>
      <p className="ts-mono">{state.path}</p>
      <p data-testid="editor-readonly-reason">{state.reason}</p>
      <p className="hint">Construct only edits a test as steps when reading it and writing it back gives the very same file, so nothing can be lost or corrupted. This file is safe: nothing was changed.</p>
    </div>
  );
}
