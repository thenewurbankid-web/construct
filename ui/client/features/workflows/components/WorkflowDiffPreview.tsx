import type { DiffHunk } from '../types';

type Props = { hunks: DiffHunk[]; busy: boolean; onConfirm: () => void; onCancel: () => void };

// Before/after diff shown ahead of writing a visual edit back to the
// workflow source (same review-then-confirm contract as the pages editor's
// snippet save). Presentation only; hunks are computed a layer up.
export function WorkflowDiffPreview({ hunks, busy, onConfirm, onCancel }: Props) {
  return (
    <div className="snippet-diff-preview" data-testid="wf-diff-preview">
      <h5>Review changes before saving</h5>
      <pre className="snippet-diff">
        {hunks.map((hunk, i) => {
          const cls = hunk.added ? 'diff-added' : hunk.removed ? 'diff-removed' : 'diff-context';
          const prefix = hunk.added ? '+ ' : hunk.removed ? '- ' : '  ';
          return (
            <span key={i} className={cls}>
              {hunk.value.replace(/\n$/, '').split('\n').map((line, j) => (
                <span className="diff-line" key={j}>{prefix}{line}{'\n'}</span>
              ))}
            </span>
          );
        })}
      </pre>
      <div className="snippet-diff-actions">
        <button type="button" onClick={onConfirm} disabled={busy}>{busy ? 'Saving…' : 'Confirm save'}</button>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
