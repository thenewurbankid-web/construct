import { getJson } from '@/lib/http';
import type { CloneJob, CloneReadResult, RemoteStatus } from '../types';

/** Real network I/O for reading clones (SERVICE-*): the one job, and the recent list. */
type Body = { ok?: boolean; error?: string; job?: CloneJob; jobs?: CloneJob[] } & Partial<RemoteStatus>;
const UNREACHABLE = 'Could not reach the server.';

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
