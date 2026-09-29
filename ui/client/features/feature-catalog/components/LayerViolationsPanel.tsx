import type { SummaryViolation } from '../types';
import './feature-catalog.css';

type Props = { layer: string; violations: SummaryViolation[] };

/** The right panel a layer's violation dot opens (#803): that layer's own rule violations, rule id,
 * file and message -- the detail the dot itself deliberately doesn't show inline. */
export function LayerViolationsPanel({ layer, violations }: Props) {
  return (
    <div data-testid="fc-violations-panel">
      <p className="fc-hint fc-violations-summary">
        {violations.length} violation{violations.length === 1 ? '' : 's'} in the {layer} layer.
      </p>
      <ul className="fc-violations-list">
        {violations.map((v, i) => (
          <li key={`${v.rule}${v.file}${i}`} className="fc-violation" data-testid="fc-violation">
            <div className="fc-violation-rule">{v.rule}</div>
            <div className="fc-mono fc-hint">{v.file}</div>
            <div>{v.message}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
