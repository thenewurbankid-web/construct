import type { ConstraintsProps } from '../types';

/** What the plan will be held to, read from architecture.yml. */
export function ConstraintsList({ constraints: c }: ConstraintsProps) {
  return (
    <>
      <h3 className="pl-h">Constraints from architecture.yml</h3>
      {c ? (
        <div data-testid="plan-constraints">
          <p className="pl-hint">{c.summary}</p>
          <ul className="pl-list">
            {c.rules.map((r) => (
              <li key={r.id} data-testid="plan-rule">
                <code>{r.id}</code> <span className="pl-hint">{r.severity}</span>
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
