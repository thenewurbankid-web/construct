import type { Notice, StepAnswer } from '../types';

/** A refusal's code and technical reason, collapsed. */
function RefusalDetails({ notice }: { notice: StepAnswer }) {
  if (notice.ok || !(notice.code || notice.detail)) return null;
  return (
    <details className="lw-details">
      <summary>Details</summary>
      <code>{[notice.code, notice.detail].filter(Boolean).join(': ')}</code>
    </details>
  );
}

/** What the last request here did: "Waiting for your approval: ..." (approve it in the Plan panel), or the refusal in
 * one sentence with its technical reason under Details. */
export function WorkflowNotice({ notice }: { notice: Notice }) {
  if (!notice) return <p className="lw-sr" aria-live="polite" />;
  const text = notice.ok ? `${notice.sentence} Approve it in the Plan panel.` : notice.sentence;
  return (
    <div className={notice.ok ? 'lw-notice' : 'lw-notice lw-notice--refused'} role="status" aria-live="polite" data-testid="lw-notice">
      <p>{text}</p>
      <RefusalDetails notice={notice} />
    </div>
  );
}
