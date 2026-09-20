import { BranchList } from '../components/BranchList';
import type { BranchListProps } from '../types';

export type ReviewListPageProps = {
  loaded: boolean;
  error: string | null;
  list: BranchListProps | null;
};

// Presentation-only: every value and handler comes from the controller.
export function ReviewListPage({ loaded, error, list }: ReviewListPageProps) {
  if (error && !list) {
    return (
      <div className="dg-empty" role="alert" data-testid="review-error">
        <p className="dg-empty-title">Branches could not be read</p>
        <p className="hint">{error}</p>
      </div>
    );
  }
  if (!loaded || !list) return <p className="hint rv-loading" role="status" data-testid="review-loading">Reading this project&apos;s branches...</p>;
  return <BranchList {...list} />;
}
