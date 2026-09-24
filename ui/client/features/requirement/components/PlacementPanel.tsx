import type { PlacementPanelProps } from '../types';

/** Step 3: where each block belongs, by the three fixed questions, and the files it will create. Presentation only. */
export function PlacementPanel({ blocks, notes, errors }: PlacementPanelProps) {
  return (
    <section className="rq-card" aria-labelledby="rq-place-h" data-testid="requirement-placement">
      <h2 className="rq-h2" id="rq-place-h">3. Where each block belongs</h2>
      {errors.map((e) => (
        <p key={e} className="rq-error" role="alert">{e}</p>
      ))}
      <ul className="rq-blocks">
        {blocks.map((b) => (
          <li key={b.id} className="rq-block" data-testid="requirement-block" data-placement={b.kind}>
            <div className="rq-row">
              <span className={`rq-badge rq-badge--${b.kind}`} data-testid="requirement-block-kind">{b.kindLabel}</span>
              <strong>{b.label}</strong>
            </div>
            <dl className="rq-answers">
              {b.answers.map((a) => (
                <div key={a.question} className="rq-answer">
                  <dt>{a.question}</dt>
                  <dd>{a.answer}</dd>
                </div>
              ))}
            </dl>
            <p className="rq-muted">{b.why}</p>
            {b.checks.length > 0 && <p className="rq-muted">Checks: {b.checks.join(', ')}</p>}
            <p className="rq-muted">Layers: {b.layers.join(', ')}</p>
            <ul className="rq-files" aria-label={`Files for ${b.label}`}>
              {b.files.map((f) => (
                <li key={f} data-testid="requirement-block-file"><code>{f}</code></li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {notes.map((n) => (
        <p key={n} className="rq-muted">{n}</p>
      ))}
    </section>
  );
}
