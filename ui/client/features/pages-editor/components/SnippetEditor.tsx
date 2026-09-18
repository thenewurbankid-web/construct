'use client';

import { useSnippetEditor } from '../hooks/useSnippetEditor';
import type { PageTree } from '../types';
import { HighlightedSnippetEditor } from './HighlightedSnippetEditor';
import { SnippetDiffPreview } from './SnippetDiffPreview';
import { SaveStatus } from './SaveStatus';
import { SnippetFlowCanvas } from './SnippetFlowCanvas';

type SnippetEditorProps = {
  feature: string;
  file: string;
  nodeId: string;
  contentHash: string;
  onSaved: (tree: PageTree) => void;
};

// #52 — isolated snippet editor with save-back. #81 added JSX syntax
// highlighting (HighlightedSnippetEditor) and a diff preview shown before
// a save is actually committed (SnippetDiffPreview) — "Save" now opens
// that preview instead of writing immediately; the real save-back call
// only fires once it's explicitly confirmed. Calls the useSnippetEditor
// hook directly (a component may import a hook; the real save/load I/O,
// highlighting, and diffing all stay behind that hook and the layers it
// calls into).
export function SnippetEditor({ feature, file, nodeId, contentHash, onSaved }: SnippetEditorProps) {
  const { snippet, setSnippet, busy, status, highlightedHtml, showDiff, diffHunks, hasChanges, requestSave, confirmSave, cancelSave } =
    useSnippetEditor(feature, file, nodeId, contentHash, onSaved);

  // Ticket F.2 (#121, epic #119) — a visual-canvas edit (a rewired wire)
  // updates the same `snippet` state a hand-typed edit would, then opens
  // the same diff-preview-before-save flow (#81) instead of writing
  // straight to disk — there is exactly one save path, regardless of which
  // view produced the new text.
  function handleVisualEdit(next: string) {
    setSnippet(next);
    requestSave();
  }

  return (
    <div className="snippet-editor">
      <h4>Snippet ({nodeId}) — isolated to this node only</h4>
      <HighlightedSnippetEditor value={snippet} highlightedHtml={highlightedHtml} onChange={setSnippet} />
      {!showDiff && (
        <button type="button" onClick={requestSave} disabled={busy || !hasChanges}>
          Preview & save
        </button>
      )}
      {showDiff && <SnippetDiffPreview hunks={diffHunks} busy={busy} onConfirm={confirmSave} onCancel={cancelSave} />}
      {status && <SaveStatus status={status} />}
      {/* Ticket F.1 (#120)/F.2 (#121, epic #119) — visual composer, always
          shown below the code editor for now; F.4 (#123) turns this into a
          Code/Visual toggle instead of both being visible at once. */}
      <h5>Visual (#120)</h5>
      <SnippetFlowCanvas snippet={snippet} onSnippetChange={handleVisualEdit} />
    </div>
  );
}
