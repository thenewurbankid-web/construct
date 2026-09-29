// GET /api/envelopes (ui/server/src/envelopesApi.mjs), a thin adapter over packages/core/flows.mjs's
// listFlows/loadFlow (#759). Read-only for this slice; save/run is #772.
import { getJson } from '@/lib/http';
import type { FlowCatalogueEntry, FlowStep, FlowSummary } from '../types';

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

export type FlowResult = { ok: true; name: string; steps: FlowStep[] } | { ok: false; error: string };

/** One saved flow's steps, for loading into the compose draft (#395/#771's center stage). */
export async function fetchFlow(name: string): Promise<FlowResult> {
  try {
    const body = await getJson<{ ok?: boolean; error?: string; steps?: FlowStep[] }>(`/api/envelopes/${encodeURIComponent(name)}`);
    if (!body.ok || !body.steps) return { ok: false, error: body.error ?? 'Could not read that flow.' };
    return { ok: true, name, steps: body.steps };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

export type CatalogueResult = { ok: true; rows: FlowCatalogueEntry[] } | { ok: false; error: string };

/** The real plan-flow catalogue (PLAN_FLOWS/block-flows.mjs) the compose step picker adds from -- reuses
 * `GET /api/plan/context`'s `flows`, the same catalogue the Plan screen's step picker already reads, rather
 * than standing up a second endpoint for the same data. */
export async function fetchFlowCatalogue(): Promise<CatalogueResult> {
  try {
    const body = await getJson<{ ok?: boolean; error?: string; flows?: FlowCatalogueEntry[] }>('/api/plan/context');
    if (!body.ok) return { ok: false, error: body.error ?? 'Could not read the flow catalogue.' };
    return { ok: true, rows: (body.flows ?? []).filter((f) => f.offered) };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}
