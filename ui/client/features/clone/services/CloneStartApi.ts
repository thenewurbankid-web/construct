import { postJson } from '@/lib/http';
import type { CloneJob, CloneStartInput, CloneStartResult, PullResult, RemoteStatus } from '../types';

/** Real network I/O for starting and cancelling a clone (SERVICE-*): thin wrappers over ui/server's /api/clone.
 * Failures come back as `{ ok: false, error }`, never thrown. */
type Body = { ok?: boolean; error?: string; code?: string; job?: CloneJob; jobs?: CloneJob[]; message?: string; upToDate?: boolean; detail?: string[] } & Partial<RemoteStatus>;
const UNREACHABLE = 'Could not reach the server.';

export async function startClone(input: CloneStartInput): Promise<CloneStartResult> {
  try {
    // The access token travels only in this request body (never a URL or a header) and is not kept anywhere here.
    const body = await postJson<Body>('/api/clone', {
      url: input.url,
      ...(input.name ? { name: input.name } : {}),
      ...(input.branch ? { branch: input.branch } : {}),
      // #638: the GitHub connection (looked up by the server for THIS session) or a pasted token, never both.
      ...(input.useLogin ? { useLogin: true } : input.token ? { token: input.token } : {}),
    });
    return body.ok && body.job ? { ok: true, job: body.job } : { ok: false, error: body.error ?? 'The clone could not be started.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** "Pull latest" for a clone this Cockpit made (fast-forward only, decided by the server). */
export async function pullClone(name: string, token: string, useLogin = false): Promise<PullResult> {
  try {
    const body = await postJson<Body>('/api/clone/pull', { name, ...(useLogin ? { useLogin: true } : token ? { token } : {}) });
    return body.ok
      ? { ok: true, message: body.message ?? 'Updated.', upToDate: !!body.upToDate, detail: body.detail ?? [] }
      : { ok: false, error: body.error ?? 'The update did not work.', code: body.code };
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
