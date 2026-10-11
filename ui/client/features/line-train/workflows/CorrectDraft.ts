import type { DraftEdit, TrainDraft } from '../types';

/** The drafter's answer as an editable draft: every route valid, the recommended one starred. */
export function startEdit(d: TrainDraft): DraftEdit {
  return {
    world: d.world, request: d.request, slots: d.slots, routes: d.routes, intent: d.intent,
    valid: Object.fromEntries(d.routes.map((r) => [r.id, true])), preferred: d.recommended,
    filled: d.filled.routes, filledRequest: d.filled.request,
  };
}

/** Mark a route valid or not; an invalid route cannot stay starred (the first valid one takes the star). */
export function toggleValid(e: DraftEdit, id: string): DraftEdit {
  const valid = { ...e.valid, [id]: e.valid[id] === false };
  const stillOk = e.preferred !== null && valid[e.preferred] !== false;
  const preferred = stillOk ? e.preferred : e.routes.find((r) => valid[r.id] !== false)?.id ?? null;
  return { ...e, valid, preferred };
}

/** Star one route as the preferred way; starring an invalid route makes it valid again. */
export function starRoute(e: DraftEdit, id: string): DraftEdit {
  return { ...e, preferred: id, valid: { ...e.valid, [id]: true } };
}
