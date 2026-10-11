import type { LineFinding } from '../types';

/** What needs attention in one item: each finding's plain-English sentence first, the rule id and file:line in a
 * collapsed Details. Nothing when the item is fine. */
export function FindingList({ name, findings }: { name: string; findings: LineFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <ul className="lf-findings" aria-label={`What needs attention in ${name}`}>
      {findings.map((f, i) => (
        <li key={`${f.rule}-${f.line}-${i}`} className={`lf-finding lf-finding--${f.severity}`} data-testid="lf-finding">
          <span>{f.sentence}</span>
          <details className="lf-details">
            <summary>Details</summary>
            <dl>
              <dt>Rule</dt>
              <dd data-testid="lf-finding-rule">{f.rule}</dd>
              <dt>Where</dt>
              <dd data-testid="lf-finding-where">
                {f.file}:{f.line}
              </dd>
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}
