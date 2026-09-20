// Reading ui/server's /api/review (read-only). Thin wrappers: no policy here. The client only ever sends
// branch NAMES; the server checks each against the project's own `git for-each-ref` and refuses the rest.
import { getJson, postJson } from '@/lib/http';
import type { BranchList, ChangeResponse } from '../types';

type Failure = { ok?: false; error?: string };

/** The list source's branches, each with its cached badges. `base` omitted -> the server's default (main). */
export async function fetchBranches(base?: string): Promise<{ ok: true; data: BranchList } | { ok: false; error: string }> {
  try {
    const q = base ? `?base=${encodeURIComponent(base)}` : '';
    const body = await getJson<(BranchList & { ok: true }) | Failure>(`/api/review/branches${q}`);
    if ('branches' in body && body.ok) return { ok: true, data: body };
    return { ok: false, error: (body as Failure).error ?? 'The branches could not be read.' };
  } catch {
    return { ok: false, error: 'The Cockpit server could not be reached.' };
  }
}

/** Ask the server to analyse these branches against `base` (idempotent; the work happens off the request thread). */
export async function requestAnalysis(base: string, heads: string[]): Promise<boolean> {
  try {
    const body = await postJson<{ ok?: boolean }>('/api/review/analyze', { base, heads });
    return !!body.ok;
  } catch {
    return false;
  }
}

/** One change: its state, and the full report once the analysis is done. */
export async function fetchChange(base: string, head: string): Promise<{ ok: true; data: ChangeResponse } | { ok: false; error: string }> {
  try {
    const body = await getJson<(ChangeResponse & { ok: true }) | Failure>(`/api/review/change?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`);
    if ('state' in body && body.ok) return { ok: true, data: body };
    return { ok: false, error: (body as Failure).error ?? 'The change could not be read.' };
  } catch {
    return { ok: false, error: 'The Cockpit server could not be reached.' };
  }
}
