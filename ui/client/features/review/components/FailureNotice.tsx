import type { FailureAction, FailureNoticeProps } from '../types';

const LABEL: Record<FailureAction, string> = { retry: 'Try again', list: 'Back to the list', settings: 'Open Settings', 'no-plan': 'Review without a plan' };

/** A failure that says what happened and what to do next (#318). Never a raw code alone. */
export function FailureNotice({ failure, testId, onAction }: FailureNoticeProps) {
  return (
    <div className="dg-empty rv-failure" role="alert" data-testid={testId}>
      <p className="dg-empty-title">{failure.title}</p>
      <p className="hint" data-testid="review-failure-what">{failure.what}</p>
      <p className="hint" data-testid="review-failure-next"><strong>What to do:</strong> {failure.next}</p>
      <div className="rv-actions">
        {failure.actions.map((a) => (
          <button key={a} type="button" className="dg-btn" data-action={a} onClick={() => onAction(a)}>{LABEL[a]}</button>
        ))}
      </div>
    </div>
  );
}
