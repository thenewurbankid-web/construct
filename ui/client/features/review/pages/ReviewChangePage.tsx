import { UnitSummaries } from '../components/UnitSummaries';
import type { UnitSummariesProps } from '../types';

export type ReviewChangePageProps = {
  status: 'loading' | 'waiting' | 'ready' | 'failed';
  head: string;
  base: string;
  subject: string | null;
  headline: string | null;
  error: string | null;
  degraded: string | null;
  units: UnitSummariesProps | null;
  onBack: () => void;
  onRetry: () => void;
};

// Presentation-only: every value and handler comes from the controller.
export function ReviewChangePage({ status, head, base, subject, headline, error, degraded, units, onBack, onRetry }: ReviewChangePageProps) {
  return (
    <div className="rv-stage" data-testid="review-change">
      <header className="rv-toolbar">
        <button type="button" className="dg-btn" onClick={onBack} data-testid="review-back">Back to the list</button>
        <h1 className="rv-h1" title={subject ?? head}>
          <code className="rv-branch">{head}</code> <span className="rv-crumb">compared against <code>{base}</code></span>
        </h1>
      </header>
      {subject && <p className="rv-lede" data-testid="review-subject">{subject}</p>}
      {status === 'failed' && (
        <div className="dg-empty" role="alert" data-testid="review-change-error">
          <p className="dg-empty-title">This change could not be analysed</p>
          <p className="hint">{error}</p>
          <button type="button" className="dg-btn" onClick={onRetry}>Try again</button>
        </div>
      )}
      {(status === 'loading' || status === 'waiting') && (
        <p className="rv-lede" role="status" data-testid="review-waiting">
          Analysing this change: reading both commits, checking your rules and comparing workflow paths. Deterministic steps, no model involved.
        </p>
      )}
      {status === 'ready' && (
        <>
          {headline && <p className="rv-summary" data-testid="review-headline">{headline}</p>}
          {degraded && <p className="dg-note" role="status" data-testid="review-degraded">{degraded}</p>}
          {units && <UnitSummaries {...units} />}
        </>
      )}
    </div>
  );
}
