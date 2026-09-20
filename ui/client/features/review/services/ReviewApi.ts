// Reading ui/server's /api/review (read-only). Thin wrappers: no policy here. The client only ever sends
// branch NAMES and a saved plan's ID; the server checks each against the project's own lists (git
// for-each-ref, the process store) and refuses the rest. Failures carry the server's `code` so the screen
// can say what to do next instead of showing a bare error.
import { getJson, postJson } from '@/lib/http';
import type { BranchList, ChangeResponse } from '../types';

type Failure = { ok?: false; error?: string; code?: string };
export type ApiFailure = { ok: false; error: string; code: string | null };

const unreachable = (): ApiFailure => ({ ok: false, error: 'The Cockpit server could not be reached.', code: 'UNREACHABLE' });
const failed = (body: Failure, fallback: string): ApiFailure => ({ ok: false, error: body.error ?? fallback, code: body.code ?? null });

/** The list source's branches, each with its cached badges. `base` omitted -> the server's default (main). */
export async function fetchBranches(base?: string): Promise<{ ok: true; data: BranchList } | ApiFailure> {
  try {
    const q = base ? `?base=${encodeURIComponent(base)}` : '';
    const body = await getJson<(BranchList & { ok: true }) | Failure>(`/api/review/branches${q}`);
    if ('branches' in body && body.ok) return { ok: true, data: body };
    return failed(body as Failure, 'The branches could not be read.');
  } catch {
    return unreachable();
  }
}

/** Ask the server to analyse these branches against `base` (idempotent; the work happens off the request thread). */
export async function requestAnalysis(base: string, heads: string[], plan?: string | null): Promise<boolean> {
  try {
    const body = await postJson<{ ok?: boolean }>('/api/review/analyze', { base, heads, ...(plan ? { plan } : {}) });
    return !!body.ok;
  } catch {
    return false;
  }
}

/** One change: its state, and the full report once the analysis is done. `plan` is a saved plan's id. */
export async function fetchChange(base: string, head: string, plan?: string | null): Promise<{ ok: true; data: ChangeResponse } | ApiFailure> {
  try {
    const p = plan ? `&plan=${encodeURIComponent(plan)}` : '';
    const body = await getJson<(ChangeResponse & { ok: true }) | Failure>(`/api/review/change?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}${p}`);
    if ('state' in body && body.ok) return { ok: true, data: body };
    return failed(body as Failure, 'The change could not be read.');
  } catch {
    return unreachable();
  }
}

