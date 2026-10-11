import type { LineFinding } from '../types';

type FindingItemProps = { finding: LineFinding };

/** One finding: the plain-English sentence first, the rule id and file:line in a collapsed Details. */
export function FindingItem({ finding }: FindingItemProps) {
  return (
    <li className={`lp-finding lp-finding--${finding.severity}`} data-testid="lp-finding">
      <span className="lp-finding-sentence">{finding.sentence}</span>
      <details className="lp-details">
        <summary>Details</summary>
        <dl>
          <dt>Rule</dt>
          <dd data-testid="lp-finding-rule">{finding.rule}</dd>
          <dt>Where</dt>
          <dd data-testid="lp-finding-where">
            {finding.file}:{finding.line}
          </dd>
        </dl>
      </details>
    </li>
  );
}
