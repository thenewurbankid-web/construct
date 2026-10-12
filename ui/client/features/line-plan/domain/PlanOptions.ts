// Two modes: a screen's chat with the Plan's options joined (ids "<screen>.plan.*"). Pure; tested by PlanChat.spec.mjs.
import type { Place, ScreenChatProvider } from '../../../lib/lineModes.ts';
import { PLAN_CHAT, planDecision, type PlanDecision, type WithPlan } from './PlanChat.ts';
import type { PlanStepRow } from '../types.ts';

/** The id prefix of the Plan's options joined to a screen's chat. */
export const planPrefix = (screen: string) => `${screen}.plan.`;

/** The decision a joined option id ("<screen>.plan.<word>.step-<n>") names, or null. */
export function planDecisionOn(screen: string, optionId: string, rows: PlanStepRow[]): PlanDecision | null {
  const prefix = planPrefix(screen);
  return optionId.startsWith(prefix) ? planDecision(`plan.${optionId.slice(prefix.length)}`, rows) : null;
}

/** A screen's provider with the Plan's options joined after its own (ids "<screen>.plan.*", so they stay the screen's).
 * The screen's levels, intro, labels and breadcrumb are unchanged. */
export function withPlanOptions<D>(provider: ScreenChatProvider<D>): ScreenChatProvider<WithPlan<D>> {
  const prefix = planPrefix(provider.screen);
  const own = (place: Place) => ({ ...place, screen: 'plan' as const });
  const labelOf = provider.labelOf;
  return {
    screen: provider.screen,
    label: provider.label,
    href: provider.href,
    params: provider.params,
    defaultMode: provider.defaultMode,
    options: (place, d) => [...provider.options(place, d.screen), ...PLAN_CHAT.options(own(place), d.plan).map((o) => ({ ...o, id: `${prefix}${o.id.slice('plan.'.length)}` }))],
    answer: (optionId, place, d) => (optionId.startsWith(prefix) ? PLAN_CHAT.answer(`plan.${optionId.slice(prefix.length)}`, own(place), d.plan) : provider.answer(optionId, place, d.screen)),
    intro: (place, d) => provider.intro(place, d.screen),
    ...(labelOf ? { labelOf: (param: string, id: string, d: WithPlan<D>) => labelOf(param, id, d.screen) } : {}),
  };
}
