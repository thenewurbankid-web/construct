import type { ApprovalRow } from '../domain/ApprovalRows';
import type { ReviewView } from '../types';
import { ArtifactReview } from './ArtifactReview';

type Props = {
  rows: ApprovalRow[];
  expandedId: string | null;
  review: ReviewView | null;
  reviewLoading: boolean;
  reviewError: string | null;
  onReviewDiff: (id: string) => void;
  onDismiss: () => void;
  onDecide: (id: string, path: string, verdict: 'approve' | 'reject', diffSha256: string | null) => void;
};

/** Every process with a file waiting on a human decision, across the whole project, not just the one
 * selected in the Processes tab (#371): the point of a bottom panel identical on every screen is that
 * an approval is never hidden behind a screen you did not happen to choose. */
export function ApprovalsList({ rows, expandedId, review, reviewLoading, reviewError, onReviewDiff, onDismiss, onDecide }: Props) {
  if (rows.length === 0) {
    return (
      <div className="dg-empty" data-testid="approvals-empty">
        <p className="dg-empty-title">Nothing waiting on you</p>
        <p className="hint">A finished process with files to approve will show here.</p>
      </div>
    );
  }
  return (
    <ul className="pr-approvals-list" data-testid="approvals-list">
      {rows.map((row) => {
        const expanded = expandedId === row.id;
        return (
          <li key={row.id} className="pr-approval" data-testid="approval-row">
            <div className="pr-approval-head">
              <span className="pr-title">{row.title}</span>
              <span className="dg-meta">{row.pending} file{row.pending === 1 ? '' : 's'} awaiting approval</span>
              {expanded ? (
                <button type="button" className="dg-btn" data-testid="approval-dismiss" onClick={onDismiss}>Dismiss</button>
              ) : (
                <button type="button" className="dg-btn dg-btn--primary" data-testid="approval-review" disabled={reviewLoading} onClick={() => onReviewDiff(row.id)}>
                  Review diff
                </button>
              )}
            </div>
            {expanded && (
              <>
                {reviewLoading && !review && <p className="hint" data-testid="approval-loading">Loading the review...</p>}
                {reviewError && <p className="dg-note" role="alert" data-testid="review-error">{reviewError}</p>}
                {review && <ArtifactReview view={review} onDecide={(path, verdict, sha) => onDecide(row.id, path, verdict, sha)} />}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
