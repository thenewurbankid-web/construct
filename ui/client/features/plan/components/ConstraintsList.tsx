import type { ConstraintsProps } from '../types';

/** What the plan will be held to, read from architecture.yml. */
export function ConstraintsList({ constraints: c }: ConstraintsProps) {
  return (
    <>
      <h3 className="pl-h">Constraints from architecture.yml</h3>
      {c ? (
        <div data-testid="plan-constraints">
          <p className="pl-hint">{c.summary}</p>
          <ul className="pl-rules" aria-label="Rules">
            {c.rules.map((r) => (
              <li key={r.id} className={`pl-rule pl-rule--${r.severity}`} data-testid="plan-rule" title={r.severity}>
                {r.id}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="pl-hint">Reading architecture.yml...</p>
      )}
    </>
  );
}
