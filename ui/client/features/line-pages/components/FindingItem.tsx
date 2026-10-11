import { LineFixController } from '@/features/line-fix';
import type { ApplyResult, LineFinding } from '../types';

/** With `onFix`, the finding's typed fixes show under it with Apply (line-fix). */
type FindingItemProps = { finding: LineFinding; onFix?: (result: ApplyResult) => void };

/** One finding: the plain-English sentence first, the rule id and file:line in a collapsed Details. */
export function FindingItem({ finding, onFix }: FindingItemProps) {
  return (
    <li className={`lp-finding lp-finding--${finding.severity}`} data-testid="lp-finding">
      <span className="lp-finding-sentence">{finding.sentence}</span>
      {onFix && <LineFixController finding={finding} onResult={onFix} />}
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
