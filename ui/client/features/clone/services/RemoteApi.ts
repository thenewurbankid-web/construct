import { getJson, postJson } from '@/lib/http';
import type { CloneJob, RemoteResult, RemoteStatus } from '../types';

/** Real network I/O for the open project's remote (SERVICE-*): ui/server's /api/git/remote. */
type Body = { ok?: boolean; error?: string; job?: CloneJob; jobs?: CloneJob[] } & Partial<RemoteStatus>;
const UNREACHABLE = 'Could not reach the server.';

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
