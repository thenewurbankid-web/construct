import { getJson, postJson } from '@/lib/http';
import type { DecideResult, GateRefusal, Review, Validation } from '../types';

/** The approval gate's read-only review of one process: the exact diff of each artifact, its hash and its refusals. */
export async function fetchReview(id: string): Promise<{ ok: true; review: Review } | { ok: false; error: string }> {
  try {
    const body = await getJson<Review & { ok?: boolean; error?: string }>(`/api/processes/${encodeURIComponent(id)}/review`);
    if (body.ok) return { ok: true, review: body };
    return { ok: false, error: body.error || 'The Construct server could not review that process.' };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

/**
 * ONE decision on ONE file. The body is exactly `{ path, verdict, diffSha256 }`: who is deciding is
 * decided by the server from the signed session, so it is not, and cannot be, sent from here, and the
 * hash is the one of the diff that was on screen, never computed here.
 */
export async function sendDecision(id: string, path: string, verdict: 'approve' | 'reject', diffSha256: string | null): Promise<DecideResult> {
  try {
    const body = await postJson<{ ok?: boolean; error?: string; refusals?: GateRefusal[]; validation?: Validation | null }>(
      `/api/processes/${encodeURIComponent(id)}/decide`,
      { path, verdict, ...(diffSha256 ? { diffSha256 } : {}) },
    );
    if (body.ok) return { ok: true, validation: body.validation ?? null };
    return { ok: false, error: body.error || 'The Construct server refused that decision.', refusals: body.refusals ?? [] };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.', refusals: [] };
  }
}
