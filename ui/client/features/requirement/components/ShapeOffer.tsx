import type { ShapeOfferProps } from '../types';

/**
 * The screen shape (#651): a closed question beside the plan, never an open one. Approve does not wait for it: until a person
 * chooses, the plan below is the plain scaffold. Choosing reads the requirement again and the plan and files redraw.
 */
export function ShapeOffer({ offers, busy, onAnswer }: ShapeOfferProps) {
  return (
    <>
      {offers.map((offer) => (
        <section key={offer.id} className="rq-card" aria-labelledby={`rq-${offer.id}-h`} data-testid="requirement-shape" data-chosen={offer.options.find((o) => o.chosen)?.id ?? ''}>
          <h2 className="rq-h2" id={`rq-${offer.id}-h`}>Screen shape</h2>
          <p className="rq-q">{offer.question}</p>
          <ul className="rq-shape-options" aria-label="Screen shape options">
            {offer.options.map((o) => (
              <li key={o.id} className="rq-shape-option" data-testid="requirement-shape-option" data-option={o.id}>
                <div className="rq-row">
                  <button type="button" className={`rq-chip${o.chosen ? ' rq-chip--on' : ''}`} aria-pressed={o.chosen} disabled={busy} data-testid={`requirement-shape-${o.id}`} onClick={() => onAnswer(offer, o.id)}>
                    {o.label}
                  </button>
                  {o.suggested && <span className="rq-badge rq-badge--presentational" data-testid="requirement-shape-suggested">suggested</span>}
                </div>
                <p className="rq-muted">{o.gives}</p>
              </li>
            ))}
          </ul>
          <p className="rq-muted" role="status" data-testid="requirement-shape-status" data-decided-by={offer.decidedBy ?? ''}>{offer.status}</p>
        </section>
      ))}
    </>
  );
}
