import { CaseCard } from './CaseCard';
import type { CaseView, ReviewControls } from '../types';

type Queue = { cases: CaseView[]; total: number; open: number; more: () => void; review: ReviewControls };

/** Claude's cases in the owner's random review sample, five at a time, unreviewed first. */
export function ReviewQueue({ queue }: { queue: Queue }) {
  const card = (c: CaseView) => <CaseCard key={c.id} c={c} review={queue.review} />;
  return (
    <section className="ltr-section" aria-labelledby="ltr-review-head" data-testid="train-review">
      <h2 id="ltr-review-head">
        Review Claude&apos;s cases <small data-testid="train-review-count">{queue.open} of {queue.total} in your sample still to review</small>
      </h2>
      <p className="ltr-lead">Claude made these on imaginary projects; Construct already checked every route. Agree if it is how you would do it.</p>
      <ul className="ltr-cases">{queue.cases.map(card)}</ul>
      <span className="ltr-actions">
        <button type="button" className="ltr-btn" onClick={queue.more}>Show 5 more</button>
      </span>
    </section>
  );
}
