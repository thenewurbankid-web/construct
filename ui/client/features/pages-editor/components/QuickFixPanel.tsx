import type { QuickFixMode } from '../services/PageSourceApi';
import type { DiffHunk } from '../types';
import { DiffHunkList } from './DiffHunkList';

type QuickFixPanelProps = {
  rule: string;
  mechanicalFixAvailable: boolean;
  mode: QuickFixMode | null;
  hunks: DiffHunk[];
  busy: boolean;
  error: string | null;
  onRequestFix: (mode: QuickFixMode) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

// #551 — the quick fix offered for one diagnostic: "Mechanical" (the rule's
// own deterministic transform, disabled where none exists for this rule) or
// "AI" (a model call scoped to just this violation), the fixture the block
// contract calls for. Either path lands as a reviewable diff (DiffHunkList,
// the same renderer the snippet/Wrap-with previews already use) before
// "Apply fix" ever touches the editor's draft — nothing is saved from here.
export function QuickFixPanel({ rule, mechanicalFixAvailable, mode, hunks, busy, error, onRequestFix, onConfirm, onCancel }: QuickFixPanelProps) {
  return (
    <div className="quick-fix-panel" data-testid="quick-fix-panel" data-rule={rule}>
      <div className="quick-fix-choice" role="group" aria-label={`Quick fix for ${rule}`}>
        <button type="button" disabled={!mechanicalFixAvailable || busy} onClick={() => onRequestFix('mechanical')} data-testid="quick-fix-mechanical">
          Fix: Mechanical
        </button>
        <button type="button" disabled={busy} onClick={() => onRequestFix('ai')} data-testid="quick-fix-ai">
          Fix: AI
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Close
        </button>
      </div>
      {!mechanicalFixAvailable && <p className="hint">No mechanical fix is known for {rule} yet — try AI.</p>}
      {busy && <p className="hint">Computing the {mode === 'ai' ? 'AI' : 'mechanical'} fix…</p>}
      {error && <p className="status-error" role="alert" data-testid="quick-fix-error">{error}</p>}
      {hunks.length > 0 && (
        <div className="quick-fix-preview" data-testid="quick-fix-preview">
          <h5>Review the fix before applying</h5>
          <DiffHunkList hunks={hunks} />
          <div className="quick-fix-actions">
            <button type="button" onClick={onConfirm} data-testid="quick-fix-apply">
              Apply fix
            </button>
            <button type="button" onClick={onCancel}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
