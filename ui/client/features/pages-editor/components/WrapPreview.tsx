import { DiffHunkList } from './DiffHunkList';
import { diffSnippetLines } from '../domain/SnippetDiff';
import type { WrapFilePreview } from '../types';

type WrapPreviewProps = { files: WrapFilePreview[]; busy: boolean; onConfirm: () => void; onCancel: () => void };

// #533 (Slice 3 of #518's design) -- the real dry-run diff for every file `construct refactor
// extract-expression` would touch (the page, plus a new Expression and any hoisted Components),
// shown per file before "Approve" ever writes anything -- the same #81 diff idiom SnippetDiffPreview
// already uses (DiffHunkList, `diff`'s own diffLines), just once per file instead of once overall.
export function WrapPreview({ files, busy, onConfirm, onCancel }: WrapPreviewProps) {
  return (
    <div className="pal-wrap-preview">
      <h5>Review before writing</h5>
      {files.map((f) => (
        <div key={f.file} className="pal-wrap-file">
          <code className="pal-wrap-file-name">{f.file}</code>
          <DiffHunkList hunks={diffSnippetLines(f.before, f.after)} />
        </div>
      ))}
      <div className="snippet-diff-actions">
        <button type="button" onClick={onConfirm} disabled={busy}>
          {busy ? 'Writing…' : 'Approve — write these files'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
