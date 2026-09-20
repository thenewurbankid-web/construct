import { ProcessArtifacts } from '../components/ProcessArtifacts';
import { ProcessList } from '../components/ProcessList';
import { ProcessLog } from '../components/ProcessLog';
import { ProcessSteps } from '../components/ProcessSteps';
import type { ProcessesViewProps } from '../types';

// Presentation-only: every value and handler comes from the controller.
export function ProcessesPage({ clones, ...props }: ProcessesViewProps) {
  return (
    <>
      {clones}
      <ProcessesBody {...props} />
    </>
  );
}

function ProcessesBody({ rows, detail, diffs, review, reviewLoading, reviewError, onReview, onDecide, busy, notice, error, live, onSelect, onControl, onShowDiff }: ProcessesViewProps) {
  if (error && rows.length === 0) {
    return (
      <div className="dg-empty" role="alert" data-testid="processes-error">
        <p className="dg-empty-title">Processes could not be read</p>
        <p className="hint">{error}</p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="dg-empty" data-testid="processes-empty">
        <p className="dg-empty-title">No processes running</p>
        <p className="hint">Long-running work will show here with progress, pause and cancel.</p>
      </div>
    );
  }
  return (
    <div className="pr-root">
      <aside className="pr-side">
        <ProcessList rows={rows} onSelect={onSelect} />
        {!live && <p className="dg-note" role="status">Not live: reconnecting to the server.</p>}
      </aside>
      {detail && (
        <>
          <section className="pr-main" aria-label="Process detail" data-testid="process-detail">
            <header className="pr-head">
              <div className="pr-head-text">
                <h2 className="pr-title">{detail.title}</h2>
                <span className={`pr-state pr-state--${detail.state}`} data-testid="process-state">{detail.stateLabel}</span>
                <span className="dg-meta">{detail.progress}</span>
              </div>
              <div className="pr-controls" role="group" aria-label="Process controls">
                {detail.buttons.map((b) => (
                  <button key={b.verb} type="button" className="dg-btn" data-testid={`process-${b.verb}`} disabled={busy} onClick={() => onControl(detail.id, b.verb)}>
                    {b.label}
                  </button>
                ))}
              </div>
            </header>
            {notice && <p className="dg-note" role="alert" data-testid="process-notice">{notice}</p>}
            {detail.error && <p className="dg-note" role="alert">{detail.error}</p>}
            <ProcessSteps steps={detail.steps} />
            <ProcessArtifacts
              rows={detail.artifacts}
              diffs={diffs}
              processId={detail.id}
              canReview={detail.canReview}
              review={review}
              reviewLoading={reviewLoading}
              reviewError={reviewError}
              onShowDiff={(path) => onShowDiff(detail.id, path)}
              onReview={() => onReview(detail.id)}
              onDecide={(path, verdict, sha) => onDecide(detail.id, path, verdict, sha)}
            />
          </section>
          <section className="pr-logpane" aria-label="Process log pane">
            <ProcessLog rows={detail.log} hidden={detail.logHidden} />
          </section>
        </>
      )}
    </div>
  );
}
