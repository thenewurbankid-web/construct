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

/** The "no remote" empty state (`ia-git-connect`, #374): shown where a remote is required -- today just the
 * PRs tab -- never over the local branch list, which works with or without one. Connecting/cloning is #330;
 * only this empty state's position is built here. */
export function GitConnectEmptyState() {
  return (
    <div className="dg-empty" data-testid="review-no-remote">
      <p className="dg-empty-title">This project has no remote yet</p>
      <p className="hint">Connect a GitHub repository to see pull requests, branches and reviews here. Cloning always goes into your single workspace root.</p>
      <div className="dg-empty-actions">
        <button type="button" className="dg-btn dg-btn--primary" data-testid="review-connect-remote" disabled title="Not built yet. See #330.">Connect remote&hellip;</button>
        <button type="button" className="dg-btn" data-testid="review-clone-repository" disabled title="Not built yet. See #330.">Clone a repository&hellip;</button>
      </div>
    </div>
  );
}
