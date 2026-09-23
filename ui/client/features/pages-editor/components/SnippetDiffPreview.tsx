import type { DiffHunk } from '../types';
import { DiffHunkList } from './DiffHunkList';

type SnippetDiffPreviewProps = {
  hunks: DiffHunk[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// #81 — before/after diff shown ahead of a save-back-to-source commit.
// Presentation only, from props: the hunks themselves are computed one
// layer up (a hook calling a pure function), never here. The hunk render
// itself lives in DiffHunkList (#533), shared with the Wrap-with preview.
export function SnippetDiffPreview({ hunks, busy, onConfirm, onCancel }: SnippetDiffPreviewProps) {
  return (
    <div className="snippet-diff-preview">
      <h5>Review changes before saving</h5>
      <DiffHunkList hunks={hunks} />
      <div className="snippet-diff-actions">
        <button type="button" onClick={onConfirm} disabled={busy}>
          {busy ? 'Saving…' : 'Confirm save'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
