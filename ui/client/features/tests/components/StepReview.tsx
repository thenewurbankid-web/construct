import type { StepReview as Review } from '../types';

type StepReviewProps = {
  review: Review;
  path: string;
  onBack: () => void;
  onConfirm: () => void;
  onReload: () => void;
};

const MARK = { added: '+', removed: '-', context: ' ', gap: '' } as const;

/** "Nothing is written until you review": the diff of exactly what will change in the file, with Confirm and Back.
 * A refusal (a stale file, an edit that cannot be written safely) is shown as it is and nothing is written. */
export function StepReview({ review, path, onBack, onConfirm, onReload }: StepReviewProps) {
  if (review.status === 'none') return null;
  return (
    <section className="ts-review" data-testid="step-review" aria-label="Review the change">
      <h3 className="ts-review-h">Review the change to <span className="ts-mono">{path}</span></h3>
      {review.status === 'loading' && <p className="hint" role="status">Checking the change...</p>}
      {review.status === 'saving' && <p className="hint" role="status">Writing the file...</p>}
      {review.status === 'error' && (
        <div className="ts-banner ts-banner--error" role="alert" data-testid="review-error">
          <h3>{review.stale ? 'The test changed while you were editing' : 'This change was not saved'}</h3>
          <p>{review.message}</p>
          <div className="ts-actions">
            {review.stale ? <button type="button" className="ts-btn ts-btn--primary" onClick={onReload}>Reload the test</button> : null}
            <button type="button" className="ts-btn" onClick={onBack}>Back to editing</button>
          </div>
        </div>
      )}
      {review.status === 'ready' && (
        <>
          {!review.changed ? (
            <p className="hint" data-testid="review-nochange">Nothing would change in the file.</p>
          ) : (
            <>
              <p className="ts-fieldhint" data-testid="review-stats">{review.added} line{review.added === 1 ? '' : 's'} added, {review.removed} removed. This is exactly what will be written.</p>
              <div className="ts-diff" role="table" aria-label="Changes to the file" data-testid="review-diff">
                {review.rows.map((r, i) => (
                  <div key={i} role="row" className={`ts-diff-row ts-diff-row--${r.kind}`} data-kind={r.kind}>
                    <span role="cell" className="ts-diff-n" aria-hidden="true">{r.newLine ?? r.oldLine ?? ''}</span>
                    <span role="cell" className="ts-diff-mark" aria-label={r.kind === 'added' ? 'added' : r.kind === 'removed' ? 'removed' : undefined}>{MARK[r.kind]}</span>
                    <span role="cell" className="ts-diff-text">{r.text}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="ts-actions">
            <button type="button" className="ts-btn ts-btn--primary" data-testid="review-confirm" disabled={!review.changed} onClick={onConfirm}>Save these changes</button>
            <button type="button" className="ts-btn" data-testid="review-back" onClick={onBack}>Back to editing</button>
          </div>
        </>
      )}
    </section>
  );
}
