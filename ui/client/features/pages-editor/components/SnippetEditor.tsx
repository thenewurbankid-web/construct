'use client';

import { useSnippetEditor } from '../hooks/useSnippetEditor';
import type { PageTree } from '../types';
import { HighlightedSnippetEditor } from './HighlightedSnippetEditor';
import { SnippetDiffPreview } from './SnippetDiffPreview';
import { SaveStatus } from './SaveStatus';

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
    </div>
  );
}
