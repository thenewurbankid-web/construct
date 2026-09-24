// The requirement chain over ui/server's POST /api/requirement/read (#642). Every rule (what a sentence may hold, which words
// are open, where each block belongs, what the plan is) is the server's and the deterministic blocks behind it; this only
// asks and reports. Approving the plan is the Plan screen's own route (runPlanOnServer), so nothing is re-implemented here.
import { postJson } from '@/lib/http';
import type { PlanDoc } from '@/features/plan';
import type { Answer, ApiResult, ProofOption, ProofRun, ProofStatusReply, ReadResult } from '../domain/RequirementTypes';

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

// #653: the proof of a generated screen. The client names a feature and sends the plan it is showing; the server re-validates the
// plan, checks the feature against it and against the project on disk, and runs the read-only `test.proof` block. No path goes over.
type ProofReply = { ok?: boolean; error?: string; code?: string; applied?: boolean; files?: string[]; options?: ProofOption[]; run?: ProofRun; reason?: string; skipped?: boolean };
type ProofFailed = { ok: false; error: string; code?: string };
const proofPost = async (route: string, body: unknown): Promise<{ ok: true; reply: ProofReply } | ProofFailed> => {
  try {
    const reply = await postJson<ProofReply>(`/api/requirement/proof/${route}`, body);
    return reply.ok ? { ok: true, reply } : { ok: false, error: reply.error ?? 'The proof could not be handled.', code: reply.code };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
};

/** Is the plan applied (its proof file is in the project)? The options are the closed ones of a proof that has not run. */
export async function proofStatusOnServer(feature: string, plan: PlanDoc): Promise<ApiResult<ProofStatusReply>> {
  const r = await proofPost('status', { feature, plan });
  return r.ok ? { ok: true, data: { applied: r.reply.applied === true, options: r.reply.options ?? [] } } : { ok: false, error: r.error };
}

/** Run the proof. A refusal (`NOT_APPLIED`, `RUN_IN_PROGRESS`) comes back as the error with its `code`. */
export async function runProofOnServer(feature: string, plan: PlanDoc): Promise<ApiResult<ProofRun> & { code?: string }> {
  const r = await proofPost('run', { feature, plan });
  if (!r.ok) return r;
  return r.reply.run ? { ok: true, data: r.reply.run } : { ok: false, error: 'The proof answered nothing.' };
}

/** Skip the proof, with a reason the server records. */
export async function skipProofOnServer(feature: string, plan: PlanDoc, reason: string): Promise<ApiResult<{ reason: string }>> {
  const r = await proofPost('skip', { feature, plan, reason });
  return r.ok ? { ok: true, data: { reason: r.reply.reason ?? reason } } : { ok: false, error: r.error };
}
