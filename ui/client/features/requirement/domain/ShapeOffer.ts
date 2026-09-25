// Pure (DOMAIN-001): the screen-shape offer (q-shape, #619) as the card the Requirement screen draws (#651). The server
// raises the offer and owns every rule; this only words it. Fixed tables, nothing decided by a model. The offer is a closed
// question beside the plan, never an open question: an unanswered offer leaves the plan the plain scaffold and never
// disables Approve.
import type { OfferView, SuggestionView } from '../types.ts';
import type { Decision, Offer, ReadResult } from './RequirementTypes.ts';
import { suggestionView } from './Suggestion.ts';

/** The button text and the one plain line of what each option gives, by option id. */
const OPTION_WORDS: Record<string, { label: string; gives: string }> = {
  list: { label: 'List screen, generated with typed code', gives: 'Creates real files that validate: the list, its rows and its loading, empty and error states.' },
  scaffold: { label: 'Empty scaffold', gives: 'Creates empty stubs with a TODO in each, for you to fill in.' },
};

/** "person" for a person; the provider for a suggestion the rules made. */
export function deciderOf(decision: Decision | undefined): string | null {
  if (!decision) return null;
  return decision.by === 'person' ? 'person' : `${decision.by}${decision.provider ? ` (${decision.provider})` : ''}`;
}

/** The data source question (q-source, #621) is asked once a shape is chosen, so it is a card of its own beside the shape's. */
export const isSourceOffer = (id: string): boolean => /^q-source(-|$)/.test(id);

/** The card heading of each other closed question of the plan (#632: the server raises them, this only titles them; an id it does not know is titled by the id). */
const PLAN_HEADINGS: Record<string, string> = { 'q-route': 'Route', 'q-dependency': 'Dependency', 'q-env': 'Environment variable', 'q-verify': 'Verification', 'q-steps': 'Wizard steps' };

/** One plain line under a question that uses a word a person may not know (#659): what a step of a wizard is. Fixed words, by question id (`q-steps-<name>` too); a question without one has none. */
const PLAN_HINTS: Record<string, string> = { 'q-steps': 'A step is one screen of the wizard: Next and Back move between steps, each step but the last takes some of the fields, and the last one shows them all and submits.' };

/** The plain line of a question, or null. */
const offerHint = (id: string): string | null => PLAN_HINTS[/^q-[a-z]+/.exec(id)?.[0] ?? ''] ?? null;

/** The heading of an offer card: the shape, the data source, or a closed question of the plan. */
export function offerHeading(id: string): string {
  if (id === 'q-shape') return 'Screen shape';
  if (isSourceOffer(id)) return 'Data source';
  return PLAN_HEADINGS[id] ?? PLAN_HEADINGS[/^q-[a-z]+/.exec(id)?.[0] ?? ''] ?? id;
}

/** The first letter in lower case, the rest as it is (a variable name keeps its capitals). */
const lowerFirst = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

function status(o: Offer, suggestion: SuggestionView | null, decidedBy: string | null, label: (id: string) => string): string {
  if (o.chosen) return `Chosen: ${label(o.chosen)}. Decided by: ${decidedBy ?? 'person'}.`;
  if (o.id !== 'q-shape') return `Not chosen yet, so the plan below uses the rules' default: ${lowerFirst(label(o.default))}.`;
  const plain = `Not chosen yet, so the plan below is the ${label('scaffold').toLowerCase()}.`;
  return suggestion ? `${plain} ${suggestion.label[0].toUpperCase()}${suggestion.label.slice(1)}: ${label(suggestion.option).toLowerCase()}.` : plain;
}

export function offerViews(result: ReadResult): OfferView[] {
  const decisions = result.placement?.decisions ?? [];
  return (result.offers ?? []).map((o) => {
    const words = (id: string) => OPTION_WORDS[id] ?? { label: o.options.find((x) => x.id === id)?.label ?? id, gives: o.options.find((x) => x.id === id)?.why ?? '' };
    const suggestion = suggestionView(result, o.id, o.suggestion ?? { option: o.default, reason: '', provider: 'rules' });
    const decidedBy = o.chosen ? deciderOf(decisions.find((d) => d.question === o.id)) : null;
    return {
      id: o.id,
      kind: o.id === 'q-shape' ? ('shape' as const) : isSourceOffer(o.id) ? ('source' as const) : ('plan' as const),
      heading: offerHeading(o.id),
      hint: offerHint(o.id),
      source: 'placement' as const,
      question: o.question,
      options: o.options.filter((x) => x.enabled).map((x) => ({ id: x.id, label: words(x.id).label, gives: words(x.id).gives, suggested: x.id === suggestion?.option, chosen: x.id === o.chosen })),
      status: status(o, suggestion, decidedBy, (id) => words(id).label),
      decidedBy,
      suggestion,
    };
  });
}
