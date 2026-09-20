// The saved plans a change can be compared with (#316): read-only, from ui/server's /api/review/plans.
// The client only ever sends a plan's ID back; the server checks it against the project's process store.
import { getJson } from '@/lib/http';
import type { PlanChoice } from '../types';

/** The saved plans of the current project. Empty when there are none (never an error state). */
export async function fetchPlans(): Promise<PlanChoice[]> {
  try {
    const body = await getJson<{ ok?: boolean; plans?: PlanChoice[] }>('/api/review/plans');
    return body.ok && Array.isArray(body.plans) ? body.plans : [];
  } catch {
    return [];
  }
}
