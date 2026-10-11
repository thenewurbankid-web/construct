import type { DraftEdit, FilledRoute, RouteCardView, TrainTry, TriedView } from '../types';

const stepsLabel = (r: FilledRoute) => {
  if (r.outcome === 'question') return 'asks first';
  if (r.outcome === 'refusal') return 'refused';
  return r.cost === 1 ? '1 step' : `${r.cost} steps`;
};

/** A Try it run as lines: each check passing or failing, in words. */
export function triedView(t: TrainTry | null | undefined): TriedView | null {
  if (!t) return null;
  return { ok: t.ok, sentence: t.sentence, checks: t.checks.map((c) => ({ text: `${c.ok ? 'Passes' : 'Fails'}: ${c.sentence}`, ok: c.ok })) };
}

function card(r: FilledRoute, valid: boolean, starred: boolean, tried: TrainTry | null | undefined): RouteCardView {
  return {
    ...r, valid, starred, tried: triedView(tried), steps_n: stepsLabel(r), stepLines: r.steps.map((s) => s.sentence),
    starLabel: starred ? '★ Preferred' : '☆ Prefer this', chip: starred ? 'Preferred' : `${r.risk} risk`,
  };
}

/** One card per route, side by side: what it is, what it touches, its steps and checks, valid or not, starred or not. */
export function routeCards(edit: DraftEdit | null, tries: Record<string, TrainTry>): RouteCardView[] {
  if (!edit) return [];
  return edit.filled.map((r) => card(r, edit.valid[r.id] !== false, edit.preferred === r.id, tries[r.id]));
}

/** A stored case's routes as read-only cards (the review queue). */
export function caseCards(routes: FilledRoute[]): RouteCardView[] {
  return routes.map((r) => card(r, true, r.preferred, null));
}
