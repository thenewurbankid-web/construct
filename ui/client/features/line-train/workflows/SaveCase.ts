import type { DraftEdit } from '../types';
import type { TrainSaveRequest } from '@/lib/lineContract';

/** The case to save from a corrected draft: only the routes marked valid, the starred one preferred; or why not. */
export function saveRequest(e: DraftEdit): { ok: true; req: TrainSaveRequest } | { ok: false; sentence: string } {
  const routes = e.routes.filter((r) => e.valid[r.id] !== false);
  if (!routes.length) return { ok: false, sentence: 'Mark at least one route as valid, or add one, before saving.' };
  const preferred = routes.some((r) => r.id === e.preferred) ? String(e.preferred) : routes[0].id;
  return { ok: true, req: { world: e.world, request: e.request, intent: e.intent, slots: e.slots, routes, preferred } };
}
