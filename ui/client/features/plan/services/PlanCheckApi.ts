// The plan: the server's verdict after every edit (/api/plan/validate) and Run (/api/plan/run). Every rule about
// what a plan may contain is the server's; the client only asks and shows the answer.
import { postJson } from '@/lib/http';
import type { ApiResult, PlanDoc, PlanError, Validation } from '../domain/PlanTypes';

type Failure = { ok?: false; error?: string; errors?: PlanError[] };
const UNREACHABLE = 'The Cockpit server could not be reached.';

export const validatePlanOnServer = async (plan: PlanDoc): Promise<ApiResult<Validation>> => {
  try {
    const body = await postJson<(Validation & { ok?: boolean }) | Failure>('/api/plan/validate', { plan });
    if ('valid' in body) return { ok: true, data: body };
    return { ok: false, error: (body as Failure).error ?? 'The plan could not be checked.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
};

/** `noteId` names the durable note the plan was made in; the server marks it ran once the process has started (#609). */
export const runPlanOnServer = async (plan: PlanDoc, noteId?: string): Promise<ApiResult<{ processId: string; models: string[] }>> => {
  try {
    const body = await postJson<{ ok?: boolean; processId?: string; models?: string[]; error?: string; errors?: PlanError[] }>('/api/plan/run', { plan, ...(noteId ? { noteId } : {}) });
    if (body.ok && body.processId) return { ok: true, data: { processId: body.processId, models: body.models ?? [] } };
    return { ok: false, error: body.error ?? 'The plan could not be started.', errors: body.errors };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
};
