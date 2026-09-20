import type { FreshnessModel } from '../types';

type CloneFreshnessProps = {
  model: FreshnessModel;
  dismissed: boolean;
  onDismiss: () => void;
};

/** A clone's freshness against the flow it was cloned from (#306). A flagged clone shows what changed, in words, and
 * the next step; nothing is rewritten, QA decides. A flow that changed elsewhere is a quiet note, not a warning. */
export function CloneFreshness({ model, dismissed, onDismiss }: CloneFreshnessProps) {
  if (model.kind === 'loading') return <p className="hint" role="status">Comparing with the flow...</p>;
  if (model.kind === 'error') return <p className="ts-err" role="alert">{model.message}</p>;
  if (model.kind === 'note') return <p className="hint" data-testid="clone-note">{model.text}</p>;
  if (model.kind !== 'stale') return null;
  if (dismissed) return <p className="hint" data-testid="stale-dismissed">Out-of-date note hidden for now. It returns when you reopen this screen.</p>;
  return (
    <section className="ts-banner ts-banner--warn" data-testid="stale-banner" aria-labelledby="stale-h">
      <h3 id="stale-h"><span className="ts-chip ts-chip--stale">{model.title}</span></h3>
      <p data-testid="stale-summary">
        {model.from ? <>Cloned from <strong>{model.from}</strong>. </> : null}
        {model.summary}
      </p>
      {model.changes.length > 0 && (
        <ul className="ts-changes" aria-label="What changed in the flow" data-testid="stale-changes">
          {model.changes.map((c, i) => (
            <li key={i} className={`ts-change ts-change--${c.kind}`} data-testid="stale-change"><strong>{c.word}.</strong> {c.text}</li>
          ))}
        </ul>
      )}
      {model.caveat && <p>{model.caveat}</p>}
      {model.next && <p className="hint" data-testid="stale-next">{model.next}</p>}
      <div className="ts-actions">
        <button type="button" className="ts-btn" data-testid="stale-dismiss" onClick={onDismiss}>It is still fine</button>
      </div>
    </section>
  );
}
