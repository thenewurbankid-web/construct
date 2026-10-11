import type { DraftEdit, FilledRoute, TrainRoute, TrainSlots } from '../types';

/** One slot corrected: a closed choice sets its ref; a typed value becomes a literal (the server stores it as a slot). */
export function setSlot(e: DraftEdit, name: string, value: string, kind: 'pick' | 'text' | 'number'): DraftEdit {
  const old = e.slots[name];
  if (!old) return e;
  const next = kind === 'pick' ? { ...old, ref: value } : { type: old.type, ...(old.kind ? { kind: old.kind } : {}), literal: kind === 'number' ? Number(value) : value };
  return { ...e, slots: { ...e.slots, [name]: next } };
}

/** A route the person added with closed choices joins the draft, valid, with the slots it needed. */
export function withRoute(e: DraftEdit, slots: TrainSlots, route: TrainRoute): DraftEdit {
  return { ...e, slots, routes: [...e.routes, route], valid: { ...e.valid, [route.id]: true }, preferred: e.preferred ?? route.id };
}

/** The server's preview of the corrected draft (names filled back) replaces the cards' text. */
export function withPreview(e: DraftEdit, request: string | undefined, routes: FilledRoute[]): DraftEdit {
  return { ...e, filled: routes, filledRequest: request ?? e.filledRequest };
}
