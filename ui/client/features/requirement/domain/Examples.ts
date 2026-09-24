// Pure (DOMAIN-001): the three example sentences the screen offers as buttons. They are the sentences of
// docs/REQUIREMENT-CARD.md and docs/PLACEMENT.md, so what a click shows is what those pages describe.
import type { Answer, Question } from './RequirementTypes.ts';

export type Example = { id: string; label: string; text: string };

export const EXAMPLES: Example[] = [
  {
    id: 'billing',
    label: 'Billing',
    text: 'A logged-in user needs to see their current subscription plan and be able to click a button to manage their billing details safely via Stripe.',
  },
  { id: 'profile-picture', label: 'Profile picture', text: 'A user wants to upload a profile picture and see it update instantly.' },
  { id: 'instant-search', label: 'Instant search', text: 'A customer wants to search products with instant keyboard filtering.' },
];

/**
 * The answers after one more is given. A word of the card is answered against the card as it stood then (its id renumbers
 * once a word is answered), so card answers are only ever appended, in order. A placement question has a stable id, so a
 * changed mind replaces the earlier answer.
 */
export function withAnswer(answers: Answer[], question: Pick<Question, 'id' | 'source'>, option: string): Answer[] {
  const kept = question.source === 'placement' ? answers.filter((a) => a.id !== question.id) : answers;
  return [...kept, { id: question.id, option }];
}
