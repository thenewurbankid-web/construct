import type { ArtifactRow, DiffResult, ReviewView } from '../types';
import { ArtifactReview } from './ArtifactReview';

type Props = {
  rows: ArtifactRow[];
  diffs: Record<string, DiffResult>;
  processId: string;
  canReview: boolean;
  review: ReviewView | null;
  reviewLoading: boolean;
  reviewError: string | null;
  onShowDiff: (path: string) => void;
  onReview: () => void;
  onDecide: (path: string, verdict: 'approve' | 'reject', diffSha256: string | null) => void;
};

/** Files the process changed: path, short hash, and the read-only diff on request. Once the process is
 * finished the person can open the gate's review, where each file is approved or rejected on its own. */
export function ProcessArtifacts({ rows, diffs, processId, canReview, review, reviewLoading, reviewError, onShowDiff, onReview, onDecide }: Props) {
  if (rows.length === 0) return null;
  return (
    <section className="pr-artifacts" aria-label="Changed files" data-testid="process-artifacts">
      <div className="pr-art-headline">
        <h3 className="pr-h">Files this process changed</h3>
        {canReview && (
          <button type="button" className="dg-btn" data-testid="process-review-open" disabled={reviewLoading} onClick={onReview}>
            {review ? 'Refresh review' : 'Review changes'}
          </button>
        )}
      </div>
      {reviewError && <p className="dg-note" role="alert" data-testid="review-error">{reviewError}</p>}
      {review ? (
        <ArtifactReview view={review} onDecide={onDecide} />
      ) : (
        <ul className="pr-art-list">
          {rows.map((row) => {
            const diff = diffs[`${processId}\n${row.path}`];
            return (
              <li key={row.path} className="pr-art" data-testid="process-artifact">
                <span className="pr-art-change">{row.change}</span>
                <code className="pr-art-path">{row.path}</code>
                <code className="pr-art-hash" title="sha256 of the new content">{row.hash}</code>
                <span className="pr-art-approval">{row.approval}</span>
                <button type="button" className="dg-btn" onClick={() => onShowDiff(row.path)} disabled={diff?.status === 'loading'}>
                  {diff ? 'Reload diff' : 'Show diff'}
                </button>
                {diff?.status === 'ready' && (
                  diff.diff
                    ? <pre className="pr-diff" data-testid="process-diff">{diff.diff}</pre>
                    : <p className="hint pr-diff-none">{diff.reason ?? 'No diff to show.'}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
