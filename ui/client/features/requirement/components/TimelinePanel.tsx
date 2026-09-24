import type { TimelinePanelProps } from '../types';

/** Step 4: the blocks in the order they run, one plain-English line each. Drawn from the placement alone, so a changed answer redraws it. */
export function TimelinePanel({ steps }: TimelinePanelProps) {
  return (
    <section className="rq-card" aria-labelledby="rq-time-h" data-testid="requirement-timeline">
      <h2 className="rq-h2" id="rq-time-h">4. What will happen, in order</h2>
      <ol className="rq-steps">
        {steps.map((s) => (
          <li key={s.order} className={`rq-step rq-step--${s.kind}`} data-testid="timeline-step" data-kind={s.kind}>
            <span className="rq-step-dot" aria-hidden="true">{s.order}</span>
            <div className="rq-step-body">
              <p className="rq-step-title">{s.title}</p>
              <p className="rq-step-line">{s.line}</p>
              {s.owner.length > 0 && <p className="rq-muted">Runs: {s.owner.join(', ')}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
