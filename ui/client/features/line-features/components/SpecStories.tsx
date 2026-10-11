import type { SpecPoint, SpecView } from '../types';

/** One acceptance point: covered (and by what, under Details) or not covered yet. */
function SpecPointView({ point: pt, file }: { point: SpecPoint; file: string }) {
  return (
    <li className="lf-point" data-testid="lf-point" data-point={pt.id}>
      <span className={pt.covered ? 'lf-chip lf-chip--ok' : 'lf-chip lf-chip--todo'} data-testid="lf-point-status">
        {pt.covered ? 'Covered' : 'Not covered yet'}
      </span>
      <span>{pt.text}</span>
      <details className="lf-details">
        <summary>Details</summary>
        <dl>
          <dt>Point</dt>
          <dd>{pt.id}</dd>
          <dt>Covered by</dt>
          <dd data-testid="lf-point-by">{pt.by.join(', ') || 'nothing yet'}</dd>
          <dt>Spec</dt>
          <dd>{file}</dd>
        </dl>
      </details>
    </li>
  );
}

/** The feature's spec: how much is covered, then each story with its acceptance points marked covered (and by what,
 * under Details) or not covered yet. */
export function SpecStories({ spec }: { spec: SpecView | null }) {
  if (!spec) {
    return (
      <section className="lf-panel" aria-labelledby="lf-spec-title" data-testid="lf-spec">
        <h3 id="lf-spec-title">Spec</h3>
        <p className="hint">This feature has no spec.md yet, so there is nothing to check coverage against.</p>
      </section>
    );
  }
  return (
    <section className="lf-panel" aria-labelledby="lf-spec-title" data-testid="lf-spec">
      <h3 id="lf-spec-title">Spec</h3>
      <p data-testid="lf-coverage">{spec.coverage}</p>
      {spec.stories.map((st) => (
        <div key={st.id} className="lf-story" data-testid="lf-story">
          <p className="lf-story-text">{st.text}</p>
          <ul className="lf-points" aria-label={`Acceptance points of: ${st.text}`}>
            {st.points.map((pt) => (
              <SpecPointView key={pt.id} point={pt} file={spec.file} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
