// Ticket text to units to impact: /api/plan/propose (a text match, no model) and /api/plan/impact.
import { postJson } from '@/lib/http';
import type { ApiResult, ImpactReport, Proposal } from '../domain/PlanTypes';

const UNREACHABLE = 'The Cockpit server could not be reached.';

export const proposeSeeds = async (text: string): Promise<ApiResult<Proposal[]>> => {
  try {
    const body = await postJson<{ ok?: boolean; seeds?: Proposal[]; error?: string }>('/api/plan/propose', { text });
    if (body.ok && body.seeds) return { ok: true, data: body.seeds };
    return { ok: false, error: body.error ?? 'The ticket text could not be read.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
};

export const analyseImpact = async (seeds: string[], accepted: string[], text: string): Promise<ApiResult<ImpactReport>> => {
  try {
    const body = await postJson<{ ok?: boolean; report?: ImpactReport; error?: string }>('/api/plan/impact', { seeds, accepted, text });
    if (body.ok && body.report) return { ok: true, data: body.report };
    return { ok: false, error: body.error ?? 'The impact could not be computed.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
};
