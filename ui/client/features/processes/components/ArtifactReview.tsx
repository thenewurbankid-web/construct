import type { ReviewView } from '../types';

type Props = {
  view: ReviewView;
  onDecide: (path: string, verdict: 'approve' | 'reject', diffSha256: string | null) => void;
};

/**
 * Review of a finished process's files, one file at a time. Each row shows the exact diff the gate would
 * apply, every reason the gate refuses it, and its own Approve and Reject. There is deliberately no
 * "approve all" and no override: Approve is disabled unless the gate cleared the file.
 */
export function ArtifactReview({ view, onDecide }: Props) {
  return (
    <div className="pr-review" data-testid="process-review">
      <p className="hint pr-review-hint">Nothing reaches your project until you approve it here, one file at a time. What lands is exactly the diff shown.</p>
      <ul className="pr-art-list">
        {view.rows.map((row) => (
          <li key={row.path} className="pr-rev" data-testid="review-artifact" data-path={row.path}>
            <div className="pr-rev-head">
              <span className="pr-art-change">{row.change}</span>
              <code className="pr-art-path">{row.path}</code>
              {row.model && <span className="pr-kind pr-kind--local-model">{row.model}</span>}
              {row.verdict && <span className="pr-rev-verdict" data-testid="review-verdict">{row.verdict}</span>}
              {!row.verdict && (
                <span className="pr-rev-actions">
                  <button
                    type="button"
                    className="dg-btn dg-btn--primary"
                    data-testid="review-approve"
                    disabled={!row.canApprove || row.busy}
                    title={row.approveOffReason ?? 'Apply exactly this diff to your project'}
                    onClick={() => onDecide(row.path, 'approve', row.diffSha256)}
                  >
                    Approve
                  </button>
                  <button type="button" className="dg-btn" data-testid="review-reject" disabled={!row.canReject || row.busy} onClick={() => onDecide(row.path, 'reject', null)}>
                    Reject
                  </button>
                </span>
              )}
            </div>
            {row.refusals.length > 0 && !row.verdict && (
              <div className="pr-rev-refused" role="alert" data-testid="review-refusal">
                <strong>Refused, and it cannot be approved.</strong>
                <ul>
                  {row.refusals.map((r) => <li key={r.code + r.message}><code>{r.code}</code> {r.message}</li>)}
                </ul>
              </div>
            )}
            {row.note && (
              <div className="pr-rev-refused" role="alert" data-testid="review-note">
                <strong>{row.note.error}</strong>
              </div>
            )}
            {row.diffLines.length > 0 && !row.verdict && (
              <pre className="pr-diff pr-diff--review" data-testid="review-diff">
                {row.diffLines.map((l) => <span key={l.key} className={`pr-dl pr-dl--${l.kind}`}>{l.text || ' '}</span>)}
              </pre>
            )}
          </li>
        ))}
      </ul>
      {view.unrecorded.length > 0 && (
        <p className="dg-note" data-testid="review-unrecorded">
          The bot's branch also holds changes no record accounts for ({view.unrecorded.join(', ')}). They are never applied.
        </p>
      )}
      {view.validationText && (
        <div className={`dg-note pr-rev-validation${view.validationOk ? '' : ' pr-rev-validation--warn'}`} role="status" data-testid="review-validation">
          <p>{view.validationText}</p>
          {view.validationViolations.length > 0 && <ul>{view.validationViolations.map((v) => <li key={v}><code>{v}</code></li>)}</ul>}
        </div>
      )}
    </div>
  );
}
