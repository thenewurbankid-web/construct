import { getJson, postJson } from '@/lib/http';
import type { CloneJob, CloneStartResult, RemoteStatus } from '../types';

/** Real network I/O for starting and cancelling a clone (SERVICE-*): thin wrappers over ui/server's /api/clone.
 * Failures come back as `{ ok: false, error }`, never thrown. */
type Body = { ok?: boolean; error?: string; job?: CloneJob; jobs?: CloneJob[] } & Partial<RemoteStatus>;
const UNREACHABLE = 'Could not reach the server.';

export async function startClone(url: string, name: string): Promise<CloneStartResult> {
  try {
    const body = await postJson<Body>('/api/clone', { url, ...(name ? { name } : {}) });
    return body.ok && body.job ? { ok: true, job: body.job } : { ok: false, error: body.error ?? 'The clone could not be started.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function cancelClone(id: string): Promise<CloneStartResult> {
  try {
    const body = await postJson<Body>(`/api/clone/${encodeURIComponent(id)}/cancel`, {});
    return body.ok && body.job ? { ok: true, job: body.job } : { ok: false, error: body.error ?? 'Could not cancel.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
