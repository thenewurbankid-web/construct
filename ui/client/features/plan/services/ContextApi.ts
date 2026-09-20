// Reading the project's constraints, features and flow catalogue from ui/server's /api/plan/context.
import { getJson, postJson } from '@/lib/http';
import type { ApiResult, PlanContext } from '../domain/PlanTypes';

type Failure = { ok?: false; error?: string };
const UNREACHABLE = 'The Cockpit server could not be reached.';

export async function fetchContext(): Promise<ApiResult<PlanContext>> {
  try {
    const body = await getJson<(PlanContext & { ok: true }) | Failure>('/api/plan/context');
    if ('flows' in body && body.ok) return { ok: true, data: body };
    return { ok: false, error: (body as Failure).error ?? 'The project context could not be read.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
