import type { LineWorkflow, LineWorkflowTransition } from '../types';

type WhenDoCardsProps = { workflow: LineWorkflow; busy: boolean; onRemove: (transitionId: string) => void };

/** Remove, for a transition the feature added (the library's stay). */
function RemoveButton({ t, busy, onRemove }: { t: LineWorkflowTransition; busy: boolean; onRemove: (id: string) => void }) {
  if (!t.removable) return null;
  return (
    <button type="button" className="lw-btn" disabled={busy} onClick={() => onRemove(t.id)} aria-label={`Remove: ${t.when}`}>
      Remove
    </button>
  );
}

/** Every transition as a When -> Do card: what triggers it and what happens. The library's transitions are marked as
 * such and stay; the feature's own can be removed (a plan step). The event and states sit under Details. */
export function WhenDoCards({ workflow, busy, onRemove }: WhenDoCardsProps) {
  const feature = workflow.feature ?? 'this feature';
  const card = (t: LineWorkflowTransition) => (
    <li key={t.id} className={t.origin === 'feature' ? 'lw-card lw-card--own' : 'lw-card'} data-testid="lw-card" data-transition={t.id}>
      <p className="lw-card-when">
        <span className="lw-kw">When</span> <span data-testid="lw-card-when">{t.when.replace(/^When /, '')}</span>
      </p>
      <p className="lw-card-do">
        <span className="lw-kw">Do</span> <span data-testid="lw-card-do">{t.do}</span>
      </p>
      <div className="lw-card-foot">
        <span className="lw-chip" data-testid="lw-card-origin">
          {t.origin === 'feature' ? `Added for ${feature}` : 'From the library'}
        </span>
        <RemoveButton t={t} busy={busy} onRemove={onRemove} />
      </div>
      <details className="lw-details">
        <summary>Details</summary>
        <dl>
          <dt>Event</dt>
          <dd>{t.event}</dd>
          <dt>From</dt>
          <dd>{t.from}</dd>
          <dt>To</dt>
          <dd>{t.to ?? '(stays)'}</dd>
        </dl>
      </details>
    </li>
  );
  return (
    <ul className="lw-cards" aria-label={`What ${workflow.name} does`}>
      {workflow.transitions.map(card)}
    </ul>
  );
}
