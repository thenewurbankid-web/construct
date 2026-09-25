import type { OfferCardProps } from '../types';
import { ShapeOption } from './ShapeOption';

/** One closed question beside the plan (#651, #621, #632, #659): its heading, the question, a plain line about a word it uses (the wizard's steps), its options, the decision provider's reason and where the answer stands. */
export function OfferCard({ offer, busy, onAnswer }: OfferCardProps) {
  const options = offer.options.map((o) => <ShapeOption key={o.id} offer={offer} option={o} busy={busy} onAnswer={onAnswer} />);
  const hint = offer.hint ? <p className="rq-muted" data-testid={`requirement-${offer.kind}-hint`}>{offer.hint}</p> : null;
  const reason = offer.suggestion?.reason ? <p className="rq-muted" data-testid={`requirement-${offer.kind}-reason`}>Why: {offer.suggestion.reason}</p> : null;
  return (
    <section className="rq-card" aria-labelledby={`rq-${offer.id}-h`} data-testid={`requirement-${offer.kind}`} data-offer={offer.id} data-chosen={offer.options.find((o) => o.chosen)?.id ?? ''}>
      <h2 className="rq-h2" id={`rq-${offer.id}-h`}>{offer.heading}</h2>
      <p className="rq-q">{offer.question}</p>
      {hint}
      <ul className="rq-shape-options" aria-label={`${offer.heading} options`}>{options}</ul>
      {reason}
      <p className="rq-muted" role="status" data-testid={`requirement-${offer.kind}-status`} data-decided-by={offer.decidedBy ?? ''}>{offer.status}</p>
    </section>
  );
}
