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

function status(o: Offer, suggestion: SuggestionView | null, decidedBy: string | null, label: (id: string) => string): string {
  if (o.chosen) return `Chosen: ${label(o.chosen)}. Decided by: ${decidedBy ?? 'person'}.`;
  if (isSourceOffer(o.id)) return `Not chosen yet, so the plan below uses the rules' default: ${label(o.default).toLowerCase()}.`;
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
      kind: isSourceOffer(o.id) ? ('source' as const) : ('shape' as const),
      source: 'placement' as const,
      question: o.question,
      options: o.options.filter((x) => x.enabled).map((x) => ({ id: x.id, label: words(x.id).label, gives: words(x.id).gives, suggested: x.id === suggestion?.option, chosen: x.id === o.chosen })),
      status: status(o, suggestion, decidedBy, (id) => words(id).label),
      decidedBy,
      suggestion,
    };
  });
}
