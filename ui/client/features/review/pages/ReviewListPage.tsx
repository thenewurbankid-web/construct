import { BranchList } from '../components/BranchList';
import { FailureNotice } from '../components/FailureNotice';
import type { BranchListProps, FailureAction, FailureView } from '../types';

export type ReviewListPageProps = {
  loaded: boolean;
  failure: FailureView | null;
  /** The repository has no branch at all (no commit yet): nothing to compare, and a next step. */
  noBranches: boolean;
  list: BranchListProps | null;
  onFailureAction: (a: FailureAction) => void;
};

// Presentation-only: every value and handler comes from the controller.
export function ReviewListPage({ loaded, failure, noBranches, list, onFailureAction }: ReviewListPageProps) {
  if (failure && !list) return <FailureNotice failure={failure} testId="review-error" onAction={onFailureAction} />;
  if (loaded && noBranches) {
    return (
      <div className="dg-empty" data-testid="review-no-branches">
        <p className="dg-empty-title">There is nothing to compare yet</p>
        <p className="hint">This repository has no branch with a commit on it, and a review compares two commits. Make a first commit, then create a branch for a change and it will be listed here.</p>
        <p className="hint"><strong>What to do:</strong> <code>git add -A &amp;&amp; git commit -m &quot;First commit&quot;</code>, then <code>git switch -c my-change</code>.</p>
      </div>
    );
  }
  if (!loaded || !list) return <p className="hint rv-loading" role="status" data-testid="review-loading">Reading this project&apos;s branches...</p>;
  return <BranchList {...list} />;
}
