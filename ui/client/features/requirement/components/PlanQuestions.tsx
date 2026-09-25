import type { ShapeOfferProps } from '../types';
import { OfferCard } from './OfferCard';

/**
 * Every closed question of the plan (the data source, a wizard's steps, the route, the dependency, environment variables, verification) under one heading and one line (#659), in the order the server asked them.
 * Nothing is drawn when the plan has none. The cards keep their own test ids; Approve never waits for an answer.
 */
export function PlanQuestions({ offers, busy, onAnswer }: ShapeOfferProps) {
  if (offers.length === 0) return null;
  const cards = offers.map((offer) => <OfferCard key={offer.id} offer={offer} busy={busy} onAnswer={onAnswer} />);
  return (
    <section className="rq-group" aria-labelledby="rq-plan-questions-h" data-testid="requirement-plan-questions">
      <h2 className="rq-h2" id="rq-plan-questions-h">Plan questions</h2>
      <p className="rq-muted" data-testid="requirement-plan-questions-note">Each question below changes a step of the plan. Answer it or leave it: an unanswered one uses the rules' default, and Approve never waits for it.</p>
      {cards}
    </section>
  );
}
