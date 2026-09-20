import { StepDocument } from '../components/StepDocument';
import { StepEditorFoot } from '../components/StepEditorFoot';
import { StepEditorHeader } from '../components/StepEditorHeader';
import { StepEditorStatus } from '../components/StepEditorStatus';
import { StepEditPanel } from '../components/StepEditPanel';
import { StepReview } from '../components/StepReview';
import type { StepEditorState, StepFields, StepRowView } from '../types';

export type StepEditorPageProps = {
  state: StepEditorState;
  view: { rows: StepRowView[]; changes: number; problems: string[] } | null;
  onClose: () => void;
  onSelect: (key: number) => void;
  onPatch: (key: number, patch: Partial<StepFields>) => void;
  onAdd: (kind: 'event' | 'state' | 'check-text') => void;
  onRemove: (key: number) => void;
  onRestore: (key: number) => void;
  onMove: (key: number, dir: -1 | 1) => void;
  onDiscard: () => void;
  onReview: () => void;
  onBack: () => void;
  onConfirm: () => void;
  onReload: () => void;
};

// Presentation-only: the stage while a test is open as a step document (design: qa-tests-editor.html). The rows are
// the document, the panel edits the selected row, and nothing reaches the file until Review -> Save.
export function StepEditorPage(p: StepEditorPageProps) {
  const { state, view } = p;
  const at = state.status === 'editing' ? state.selected : null;
  return (
    <div className="ts-editor" data-testid="step-editor">
      <div className="ts-toolbar">
        <button type="button" className="ts-btn" data-testid="editor-close" onClick={p.onClose}>Back to coverage</button>
        <span className="ts-det">DETERMINISTIC</span>
      </div>
      <StepEditorStatus state={state} />
      {state.status === 'editing' && view && (
        <>
          <StepEditorHeader state={state} changes={view.changes} />
          <div className="ts-editor-grid">
            <StepDocument rows={view.rows} selected={at} onSelect={p.onSelect} onRestore={p.onRestore} onAdd={p.onAdd} canAddEvent={state.machine.events.length > 0} canAddState={state.machine.states.length > 0} />
            <StepEditPanel row={view.rows.find((r) => r.key === at) ?? null} machine={state.machine} onPatch={(patch) => at !== null && p.onPatch(at, patch)} onMove={(dir) => at !== null && p.onMove(at, dir)} onRemove={() => at !== null && p.onRemove(at)} />
          </div>
          <StepEditorFoot changes={view.changes} problems={view.problems} reviewing={state.review.status === 'loading'} announce={state.announce} onReview={p.onReview} onDiscard={p.onDiscard} />
          <StepReview review={state.review} path={state.path} onBack={p.onBack} onConfirm={p.onConfirm} onReload={p.onReload} />
        </>
      )}
    </div>
  );
}
