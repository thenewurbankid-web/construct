import type { ShapeOfferProps } from '../types';
import { ShapeOption } from './ShapeOption';

/**
 * The screen shape (#651) and, once a shape is chosen, the data source (#621): each a closed question beside the plan, never an open one. Approve does not wait for it: until a person
 * chooses, the plan below is the plain scaffold. Choosing reads the requirement again and the plan and files redraw. The decision
 * provider's suggestion is marked and explained (#633); it is never chosen for the person.
 */
export function ShapeOffer({ offers, busy, onAnswer }: ShapeOfferProps) {
  return (
    <>
      {offers.map((offer) => (
        <section key={offer.id} className="rq-card" aria-labelledby={`rq-${offer.id}-h`} data-testid={`requirement-${offer.kind}`} data-chosen={offer.options.find((o) => o.chosen)?.id ?? ''}>
          <h2 className="rq-h2" id={`rq-${offer.id}-h`}>{offer.kind === 'source' ? 'Data source' : 'Screen shape'}</h2>
          <p className="rq-q">{offer.question}</p>
          <ul className="rq-shape-options" aria-label={offer.kind === 'source' ? 'Data source options' : 'Screen shape options'}>
            {offer.options.map((o) => <ShapeOption key={o.id} offer={offer} option={o} busy={busy} onAnswer={onAnswer} />)}
          </ul>
          {offer.suggestion?.reason && <p className="rq-muted" data-testid={`requirement-${offer.kind}-reason`}>Why: {offer.suggestion.reason}</p>}
          <p className="rq-muted" role="status" data-testid={`requirement-${offer.kind}-status`} data-decided-by={offer.decidedBy ?? ''}>{offer.status}</p>
        </section>
      ))}
    </>
  );
}
