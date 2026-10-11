import type { FeatureSection } from '../types';

/** Each feature's own components with the library item they are based on. A component with a problem says so
 * in plain English; the rule id and file:line wait under a collapsed Details. */
export function FeatureComponents({ features }: { features: FeatureSection[] }) {
  if (!features.length) return <p className="ll-hint">No feature has its own components yet.</p>;
  return (
    <>
      {features.map((f) => (
        <section key={f.name} className="ll-feature" aria-labelledby={`ll-feature-${f.name}`} data-testid="ll-feature">
          <h3 id={`ll-feature-${f.name}`} className="ll-feature-head">
            {f.name}
          </h3>
          <ul className="ll-feature-list" aria-label={`Components of ${f.name}`}>
            {f.rows.map((r) => (
              <li key={r.id} className="ll-feature-row" data-testid="ll-feature-row" data-problem={r.problem ? 'true' : 'false'}>
                <span className="ll-card-title">{r.name}</span>
                <span className={r.linked ? 'll-chip ll-chip--accent' : 'll-chip ll-chip--warn'} data-testid="ll-base">
                  {r.baseText}
                </span>
                {r.findings.map((x) => (
                  <p key={`${x.rule}:${x.line}`} className="ll-finding">
                    {x.sentence}
                  </p>
                ))}
                <details className="ll-tech">
                  <summary>Details</summary>
                  <code>{r.file}</code>
                  {r.findings.map((x) => (
                    <span key={`${x.rule}:${x.line}`} className="ll-tech-line">
                      <span>{x.rule}</span> <code>{`${x.file}:${x.line}`}</code>
                    </span>
                  ))}
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
