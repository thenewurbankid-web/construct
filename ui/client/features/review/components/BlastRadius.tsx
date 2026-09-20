import type { BlastRadiusProps } from '../types';
import { PlanPicker } from './PlanPicker';

/** Stage strip (#316): what the plan declared against what changed, both ways; or a calm "Not measured". */
export function BlastRadius({ view, picker }: BlastRadiusProps) {
  if (!view.measured) {
    return (
      <section className="rv-scope rv-scope--neutral" data-testid="review-scope" data-measured="no" aria-label="Scope">
        <div className="rv-scope-head">
          <h2 className="rv-scope-title">{view.title}</h2>
          <span className="rv-badge rv-badge--neutral" data-testid="review-scope-status">Not measured</span>
        </div>
        <p data-testid="review-scope-text">{view.text}</p>
        <PlanPicker {...picker} />
      </section>
    );
  }
  return (
    <section className={`rv-scope rv-scope--${view.tone}`} data-testid="review-scope" data-measured="yes" aria-label="Scope">
      <div className="rv-scope-head">
        <h2 className="rv-scope-title">Declared vs actual scope</h2>
        <span className={`rv-badge rv-badge--${view.tone}`} data-testid="review-scope-status">{view.statusLabel}</span>
      </div>
      <p data-testid="review-scope-headline">{view.headline}</p>
      <table className="rv-scope-table">
        <thead><tr><th scope="col">Feature</th><th scope="col">In the plan</th><th scope="col">Changed here</th><th scope="col">What that means</th></tr></thead>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.feature} data-testid="review-scope-row" data-feature={r.feature} data-declared={r.declared ? 'yes' : 'no'}>
              <th scope="row">{r.feature}</th>
              <td>{r.declared ? 'yes' : 'no'}</td>
              <td>{r.files === 0 ? 'nothing' : `${r.files} ${r.files === 1 ? 'file' : 'files'}`}</td>
              <td>{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.extraFilesTotal > 0 && (
        <details className="rv-scope-more" data-testid="review-scope-extra">
          <summary>Show the {view.extraFilesTotal} {view.extraFilesTotal === 1 ? 'file' : 'files'} the plan did not list</summary>
          <ul>{view.extraFiles.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
        </details>
      )}
      {view.missingFiles.length > 0 && (
        <details className="rv-scope-more" data-testid="review-scope-missing">
          <summary>Show the {view.missingFiles.length} planned {view.missingFiles.length === 1 ? 'file' : 'files'} not changed yet</summary>
          <ul>{view.missingFiles.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
        </details>
      )}
      <PlanPicker {...picker} />
    </section>
  );
}
