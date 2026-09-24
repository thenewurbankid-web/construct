import type { UnitPickerProps } from '../types';
import { ProposalList } from './ProposalList';

/** Which units the ticket is about: pick them, or ask for suggestions and confirm one by one. */
export function UnitPicker(p: UnitPickerProps) {
  return (
    <>
      <h3 className="pl-h">Which units does it touch?</h3>
      <div className="pl-chips" role="group" aria-label="Features">
        {p.features.map((f) => (
          <button key={f.ref} type="button" className="pl-chip" aria-pressed={p.picked.includes(f.ref)} onClick={() => p.onTogglePick(f.ref)} data-testid={`plan-pick-${f.name}`}>
            {f.name}
          </button>
        ))}
        {p.features.length === 0 && <span className="pl-hint">This project has no features yet.</span>}
      </div>
      <button type="button" className="dg-btn" onClick={p.onPropose} disabled={p.proposalsBusy || !p.canPropose} data-testid="plan-propose">
        {p.proposalsBusy ? 'Looking...' : 'Find related parts'}
      </button>
      <p className="pl-hint">A text match against your project. No model. Suggestions are guesses: confirm each one you agree with.</p>
      {p.proposalsError && (
        <p className="pl-err" role="alert" data-testid="plan-propose-error">
          {p.proposalsError}
        </p>
      )}
      <ProposalList proposals={p.proposals} accepted={p.accepted} onToggleAccept={p.onToggleAccept} />
    </>
  );
}
