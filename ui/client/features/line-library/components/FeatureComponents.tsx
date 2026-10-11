import type { ChangeControls, FeatureComponentRow, FeatureSection } from '../types';
import { PromoteConfirm } from './PromoteConfirm';
import { ReadOnlyTag } from './ReadOnlyTag';

function Row({ row, controls }: { row: FeatureComponentRow; controls: ChangeControls }) {
  const open = (controls.change.status === 'promote' || controls.change.status === 'promote-saving') && controls.change.featureItemId === row.id;
  return (
    <li className="ll-feature-row" data-testid="ll-feature-row" data-problem={row.problem ? 'true' : 'false'}>
      <span className="ll-card-title">{row.name}</span>
      <span className={row.linked ? 'll-chip ll-chip--accent' : 'll-chip ll-chip--warn'} data-testid="ll-base">
        {row.baseText}
      </span>
      <ReadOnlyTag show={row.readOnly} />
      {row.findings.map((x) => (
        <p key={`${x.rule}:${x.line}`} className="ll-finding">
          {x.sentence}
        </p>
      ))}
      {open ? (
        <PromoteConfirm controls={controls} text={row.promoteText} />
      ) : (
        <button type="button" className="ll-btn" aria-label={`Promote to library: ${row.name}`} onClick={() => controls.openPromote(row.id, row.name)}>
          Promote to library
        </button>
      )}
      <details className="ll-tech">
        <summary>Details</summary>
        <code>{row.file}</code>
        {row.findings.map((x) => (
          <span key={`${x.rule}:${x.line}`} className="ll-tech-line">
            <span>{x.rule}</span> <code>{`${x.file}:${x.line}`}</code>
          </span>
        ))}
      </details>
    </li>
  );
}

/** Each feature's own components with the library item they are based on, and "Promote to library". A component
 * with a problem says so in plain English; the rule id and file:line wait under a collapsed Details. */
export function FeatureComponents({ features, controls }: { features: FeatureSection[]; controls: ChangeControls }) {
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
              <Row key={r.id} row={r} controls={controls} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
