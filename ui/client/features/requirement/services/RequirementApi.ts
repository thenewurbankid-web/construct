// The requirement chain over ui/server's POST /api/requirement/read (#642). Every rule (what a sentence may hold, which words
// are open, where each block belongs, what the plan is) is the server's and the deterministic blocks behind it; this only
// asks and reports. Approving the plan is the Plan screen's own route (runPlanOnServer), so nothing is re-implemented here.
import { postJson } from '@/lib/http';
import type { Answer, ApiResult, ReadResult } from '../domain/RequirementTypes';

type Reply = Partial<ReadResult> & { ok?: boolean; error?: string };
const UNREACHABLE = 'The Cockpit server could not be reached.';

export async function readRequirement(text: string, answers: Answer[]): Promise<ApiResult<ReadResult>> {
  try {
    const body = await postJson<Reply>('/api/requirement/read', { text, answers });
    if (body.ok && body.card) return { ok: true, data: body as ReadResult };
    return { ok: false, error: body.error ?? 'The requirement could not be read.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
