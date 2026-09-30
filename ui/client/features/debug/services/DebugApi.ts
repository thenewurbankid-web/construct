// The debug chain over ui/server's POST /api/debug/read (LIN-137). Every rule (the four questions, which options
// are on offer, the compiled plan) is the server's and the deterministic blocks behind it; this only asks and
// reports. Approving the plan reuses the Plan screen's own run route (runPlanOnServer), as the requirement chain does.
import { postJson } from '@/lib/http';
import type { Answer, ApiResult, ReadResult } from '../domain/DebugTypes';

type Reply = Partial<ReadResult> & { ok?: boolean; error?: string };
const UNREACHABLE = 'The Cockpit server could not be reached.';

export async function readDebug(feature: string, answers: Answer[]): Promise<ApiResult<ReadResult>> {
  try {
    const body = await postJson<Reply>('/api/debug/read', { feature, answers });
    if (body.ok && body.summaries) return { ok: true, data: body as ReadResult };
    return { ok: false, error: body.error ?? 'The debug chain could not be read.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
