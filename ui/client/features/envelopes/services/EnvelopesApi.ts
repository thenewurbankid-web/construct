// ui/server/src/envelopesApi.mjs, a thin adapter over packages/core/flows.mjs's listFlows/loadFlow/saveFlow
// (#759), a deterministic envelope preview, and "Run this flow" (#772) through the same Process/Approvals
// path Plan mode's "Run plan" uses -- no new/bypass execution mechanism.
import { getJson, postJson } from '@/lib/http';
import type { ComposeStep, EnvelopePreview, FlowCatalogueEntry, FlowStep, FlowSummary } from '../types';

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

export type PreviewResult = { ok: true; previews: EnvelopePreview[] } | { ok: false; error: string };

/** The envelope each step of the draft would receive, matching schemas/envelope.v1.json's input shape --
 * computed deterministically (no generator runs), one entry per step index. */
export async function previewEnvelopes(steps: ComposeStep[]): Promise<PreviewResult> {
  try {
    const body = await postJson<{ ok?: boolean; error?: string; previews?: EnvelopePreview[] }>('/api/envelopes/preview', { steps });
    if (!body.ok || !body.previews) return { ok: false, error: body.error ?? 'Could not compute the envelope preview.' };
    return { ok: true, previews: body.previews };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

export type SaveFlowResult = { ok: true } | { ok: false; error: string };

/** Previews (commit false) or commits (#759's saveFlow) the draft under `name`, same preview/commit shape as
 * the Rules tab's writers. */
export async function saveComposedFlow(name: string, steps: ComposeStep[], commit: boolean): Promise<SaveFlowResult> {
  try {
    const body = await postJson<{ ok?: boolean; error?: string; errors?: string[] }>(`/api/envelopes/${encodeURIComponent(name)}`, { steps, commit });
    if (!body.ok) return { ok: false, error: body.error ?? (body.errors ?? []).join(' ') ?? 'Could not save that flow.' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

export type RunFlowResult = { ok: true; processId: string; models: string[] } | { ok: false; error: string };

/** "Run this flow" (#772): POST /api/envelopes/run wraps the draft's steps in a synthetic plan and runs the
 * exact same validate-then-start pipeline Plan mode's "Run plan" uses (planService.run(), the process engine
 * the Processes drawer reads) -- never a second execution mechanism. `name` is only the process's label;
 * running does not require having saved first. */
export async function runComposedFlow(name: string | null, steps: ComposeStep[]): Promise<RunFlowResult> {
  try {
    const body = await postJson<{ ok?: boolean; error?: string; errors?: unknown[]; processId?: string; models?: string[] }>('/api/envelopes/run', { steps, ...(name ? { name } : {}) });
    if (!body.ok || !body.processId) return { ok: false, error: body.error ?? 'The flow could not be started.' };
    return { ok: true, processId: body.processId, models: body.models ?? [] };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}
