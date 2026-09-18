import type { DiffHunk } from '../types';

type SnippetDiffPreviewProps = {
  hunks: DiffHunk[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// #81 — before/after diff shown ahead of a save-back-to-source commit.
// Presentation only, from props: the hunks themselves are computed one
// layer up (a hook calling a pure function), never here.
export function SnippetDiffPreview({ hunks, busy, onConfirm, onCancel }: SnippetDiffPreviewProps) {
  return (
    <div className="snippet-diff-preview">
      <h5>Review changes before saving</h5>
      <pre className="snippet-diff">
        {hunks.map((hunk, i) => {
          const cls = hunk.added ? 'diff-added' : hunk.removed ? 'diff-removed' : 'diff-context';
          const prefix = hunk.added ? '+ ' : hunk.removed ? '- ' : '  ';
          const lines = hunk.value.replace(/\n$/, '').split('\n');
          return (
            <span key={i} className={cls}>
              {lines.map((line, j) => (
                <span className="diff-line" key={j}>
                  {prefix}
                  {line}
                  {'\n'}
                </span>
              ))}
            </span>
          );
        })}
      </pre>
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
