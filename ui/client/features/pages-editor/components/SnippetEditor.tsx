'use client';

import { useState } from 'react';
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

type SnippetView = 'code' | 'visual';

// #52 — isolated snippet editor with save-back. #81 added JSX syntax
// highlighting (HighlightedSnippetEditor) and a diff preview shown before
// a save is actually committed (SnippetDiffPreview) — "Save" now opens
// that preview instead of writing immediately; the real save-back call
// only fires once it's explicitly confirmed. Calls the useSnippetEditor
// hook directly (a component may import a hook; the real save/load I/O,
// highlighting, and diffing all stay behind that hook and the layers it
// calls into).
//
// Ticket F.4 (#123, epic #119) — `view` is plain local UI state (same
// pattern TreePanel.tsx already uses for its own local concerns, not a
// domain/service/workflow import — COMPONENT-003 unaffected) choosing
// which of the two editors is mounted. Both operate on the exact same
// `snippet` string from useSnippetEditor (true since F.1 built the visual
// canvas against that same state on purpose) — so switching views mid-edit
// loses nothing: there is no per-view copy to reconcile, just one shared
// string and two renderers for it. The diff preview + save status stay
// outside the toggle, so a save started in either view finishes the same
// way regardless of which view is showing when it's confirmed.
export function SnippetEditor({ feature, file, nodeId, contentHash, onSaved }: SnippetEditorProps) {
  const { snippet, setSnippet, busy, status, highlightedHtml, showDiff, diffHunks, hasChanges, requestSave, confirmSave, cancelSave } =
    useSnippetEditor(feature, file, nodeId, contentHash, onSaved);
  const [view, setView] = useState<SnippetView>('code');

  // Ticket F.2 (#121, epic #119) — a visual-canvas edit (a rewired wire, or
  // an F.3 structural op) updates the same `snippet` state a hand-typed
  // edit would, then opens the same diff-preview-before-save flow (#81)
  // instead of writing straight to disk — there is exactly one save path,
  // regardless of which view produced the new text.
  function handleVisualEdit(next: string) {
    setSnippet(next);
    requestSave();
  }

  return (
    <div className="snippet-editor">
      <h4>Snippet ({nodeId}) — isolated to this node only</h4>
      <div className="snippet-view-toggle" role="tablist" aria-label="Snippet view">
        <button type="button" className={view === 'code' ? 'active' : ''} aria-pressed={view === 'code'} onClick={() => setView('code')}>
          Code
        </button>
        <button type="button" className={view === 'visual' ? 'active' : ''} aria-pressed={view === 'visual'} onClick={() => setView('visual')}>
          Visual
        </button>
      </div>
      {view === 'code' ? (
        <HighlightedSnippetEditor value={snippet} highlightedHtml={highlightedHtml} onChange={setSnippet} />
      ) : (
        <SnippetFlowCanvas snippet={snippet} onSnippetChange={handleVisualEdit} />
      )}
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
