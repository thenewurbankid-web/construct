'use client';

import { useSnippetEditor } from '../hooks/useSnippetEditor';
import type { PageTree } from '../types';
import { SaveStatus } from './SaveStatus';

type SnippetEditorProps = {
  feature: string;
  file: string;
  nodeId: string;
  contentHash: string;
  onSaved: (tree: PageTree) => void;
};

// #52 — isolated snippet editor with save-back. Calls the useSnippetEditor
// hook directly (a component may import a hook; the real save/load I/O
// stays behind the service layer that hook calls into).
export function SnippetEditor({ feature, file, nodeId, contentHash, onSaved }: SnippetEditorProps) {
  const { snippet, setSnippet, busy, status, save } = useSnippetEditor(feature, file, nodeId, contentHash, onSaved);
  return (
    <div className="snippet-editor">
      <h4>Snippet ({nodeId}) — isolated to this node only</h4>
      <textarea
        className="snippet-textarea"
        value={snippet}
        onChange={(e) => setSnippet(e.target.value)}
        rows={Math.min(16, Math.max(4, snippet.split('\n').length + 1))}
        spellCheck={false}
      />
      <button type="button" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save snippet'}
      </button>
      {status && <SaveStatus status={status} />}
    </div>
  );
}
