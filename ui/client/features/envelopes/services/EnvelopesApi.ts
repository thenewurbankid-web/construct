// GET /api/envelopes (ui/server/src/envelopesApi.mjs), a thin adapter over packages/core/flows.mjs's
// listFlows/loadFlow (#759). Read-only for this slice; compose/save/run is #772.
import { getJson } from '@/lib/http';
import type { FlowSummary } from '../types';

export type EnvelopesResult = { ok: true; rows: FlowSummary[] } | { ok: false; error: string };

/** Every flow saved for the current project. */
export async function fetchFlows(): Promise<EnvelopesResult> {
  try {
    const body = await getJson<{ ok?: boolean; error?: string; flows?: FlowSummary[] }>('/api/envelopes');
    if (!body.ok) return { ok: false, error: body.error ?? 'Could not read saved flows.' };
    return { ok: true, rows: body.flows ?? [] };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}
