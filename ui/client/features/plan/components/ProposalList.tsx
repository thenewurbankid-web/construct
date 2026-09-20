import type { UnitPickerProps } from '../types';

/** Suggestions from the text match. Each one is a guess with its evidence, and only the ones you confirm count. */
export function ProposalList({ proposals, accepted, onToggleAccept }: Pick<UnitPickerProps, 'proposals' | 'accepted' | 'onToggleAccept'>) {
  if (!proposals) return null;
  return (
    <ul className="pl-list" aria-label="Suggested units" data-testid="plan-proposals">
      {proposals.length === 0 && (
        <li className="pl-hint" data-testid="plan-proposals-none">
          Nothing in your note matched a unit in this project. Pick the units yourself above.
        </li>
      )}
      {proposals.map((s) => (
        <li key={s.ref} className="pl-prop" data-testid="plan-proposal">
          <input type="checkbox" checked={accepted.includes(s.ref)} onChange={() => onToggleAccept(s.ref)} aria-label={`Confirm ${s.ref}`} data-testid="plan-proposal-confirm" />
          <div>
            <div>
              <span className="pl-prop-ref pl-mono">{s.ref}</span> <span className="pl-badge pl-badge--inferred">{s.badge}</span>
            </div>
            <div className="pl-hint">{s.why}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
