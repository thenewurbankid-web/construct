import { getJson, postJson } from '@/lib/http';
import type { CloneJob, CloneReadResult, CloneStartResult, RemoteResult, RemoteStatus } from '../types';

/** Real network I/O for cloning (SERVICE-*): thin wrappers over ui/server's /api/clone and /api/git/remote.
 * Failures come back as `{ ok: false, error }`, never thrown. */
const UNREACHABLE = 'Could not reach the server.';

type Body = { ok?: boolean; error?: string; job?: CloneJob; jobs?: CloneJob[] } & Partial<RemoteStatus>;

export async function startClone(url: string, name: string): Promise<CloneStartResult> {
  try {
    const body = await postJson<Body>('/api/clone', { url, ...(name ? { name } : {}) });
    return body.ok && body.job ? { ok: true, job: body.job } : { ok: false, error: body.error ?? 'The clone could not be started.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function readClone(id: string): Promise<CloneReadResult> {
  try {
    const body = await getJson<Body>(`/api/clone/${encodeURIComponent(id)}`);
    return body.ok && body.job ? { ok: true, job: body.job } : { ok: false, error: body.error ?? 'No such clone.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function listClones(): Promise<CloneJob[] | null> {
  try {
    const body = await getJson<Body>('/api/clone');
    return body.ok ? (body.jobs ?? []) : null;
  } catch {
    return null;
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

const statusOf = (b: Body): RemoteStatus => ({ repo: !!b.repo, connected: !!b.connected, url: b.url ?? null });

export async function readRemote(): Promise<RemoteResult> {
  try {
    const body = await getJson<Body>('/api/git/remote');
    return body.ok ? { ok: true, status: statusOf(body) } : { ok: false, error: body.error ?? 'Could not read the remote.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function connectRemote(url: string): Promise<RemoteResult> {
  try {
    const body = await postJson<Body>('/api/git/remote', { url });
    return body.ok ? { ok: true, status: statusOf(body) } : { ok: false, error: body.error ?? 'Could not connect the remote.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
