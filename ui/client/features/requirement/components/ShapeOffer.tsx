import type { ShapeOfferProps } from '../types';
import { OfferCard } from './OfferCard';
import { PlanQuestions } from './PlanQuestions';

/**
 * The screen shape (#651) and, once a shape is chosen, the questions of the plan (#621, #632, #659), each a closed question beside the plan, never an open one. Approve does not wait for it: until a person
 * chooses, the plan below is the plain scaffold. Choosing reads the requirement again and the plan and files redraw. The decision
 * provider's suggestion is marked and explained (#633); it is never chosen for the person. The shape card comes first; the rest sit under "Plan questions".
 */
export function ShapeOffer({ offers, busy, onAnswer }: ShapeOfferProps) {
  const shape = offers.filter((o) => o.kind === 'shape').map((offer) => <OfferCard key={offer.id} offer={offer} busy={busy} onAnswer={onAnswer} />);
  return (
    <>
      {shape}
      <PlanQuestions offers={offers.filter((o) => o.kind !== 'shape')} busy={busy} onAnswer={onAnswer} />
    </>
  );
}
