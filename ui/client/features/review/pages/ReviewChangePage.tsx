import { BlastRadius } from '../components/BlastRadius';
import { FailureNotice } from '../components/FailureNotice';
import { FindingDetail } from '../components/FindingDetail';
import { UnitSummaries } from '../components/UnitSummaries';
import type { BlastRadiusProps, FailureAction, FailureView, FindingDetailView, UnitSummariesProps } from '../types';

export type ReviewChangePageProps = {
  status: 'loading' | 'waiting' | 'ready' | 'failed';
  head: string;
  base: string;
  subject: string | null;
  headline: string | null;
  failure: FailureView | null;
  degraded: string | null;
  scope: BlastRadiusProps | null;
  finding: FindingDetailView | null;
  units: UnitSummariesProps | null;
  onBack: () => void;
  onCancel: () => void;
  onFailureAction: (a: FailureAction) => void;
  onCloseFinding: () => void;
};

// Presentation-only: every value and handler comes from the controller.
export function ReviewChangePage({ status, head, base, subject, headline, failure, degraded, scope, finding, units, onBack, onCancel, onFailureAction, onCloseFinding }: ReviewChangePageProps) {
  return (
    <div className="rv-stage" data-testid="review-change">
      <header className="rv-toolbar">
        <button type="button" className="dg-btn" onClick={onBack} data-testid="review-back">Back to the list</button>
        <h1 className="rv-h1" title={subject ?? head}>
          <code className="rv-branch">{head}</code> <span className="rv-crumb">compared against <code>{base}</code></span>
        </h1>
      </header>
      {subject && <p className="rv-lede" data-testid="review-subject">{subject}</p>}
      {status === 'failed' && failure && <FailureNotice failure={failure} testId="review-change-error" onAction={onFailureAction} />}
      {(status === 'loading' || status === 'waiting') && (
        <div className="rv-progress" role="status" data-testid="review-waiting">
          <p className="rv-lede">Analysing this change. The branch list and the changed units stay usable; the results fill in as they arrive.</p>
          <ol className="rv-steps" aria-label="What is being computed">
            <li>Reading the changed files from both commits</li>
            <li>Placing each file in its feature and layer</li>
            <li>Checking your rules on the base and on the head</li>
            <li>Comparing workflow paths</li>
          </ol>
          <p className="rv-hint">Deterministic steps, no model involved. Nothing is written to your repository.</p>
          <p className="rv-hint">This runs as a process: it is listed in the Processes drawer, where it can be paused or cancelled.</p>
          <button type="button" className="dg-btn" data-testid="review-cancel" onClick={onCancel}>Cancel this analysis</button>
        </div>
      )}
      {status === 'ready' && (
        <>
          {headline && <p className="rv-summary" data-testid="review-headline">{headline}</p>}
          {degraded && (
            <div className="rv-degraded" role="status" data-testid="review-degraded">
              <p className="rv-degraded-h">This is a large change, so it is summarised by feature</p>
              <p>{degraded}</p>
            </div>
          )}
          {scope && <BlastRadius {...scope} />}
          {finding && <FindingDetail detail={finding} onClose={onCloseFinding} />}
          {units && <UnitSummaries {...units} />}
        </>
      )}
    </div>
  );
}
