// Starting and cancelling an analysis (ui/server's POST /api/review/analyze and /cancel). Mutating POSTs; the client
// only ever sends branch NAMES and a saved plan's ID, and the server checks each against the project's own lists.
import { postJson } from '@/lib/http';

/** Ask the server to analyse these branches against `base` (idempotent; the work happens off the request thread). */
export async function requestAnalysis(base: string, heads: string[], plan?: string | null): Promise<boolean> {
  try {
    const body = await postJson<{ ok?: boolean }>('/api/review/analyze', { base, heads, ...(plan ? { plan } : {}) });
    return !!body.ok;
  } catch {
    return false;
  }
}

/** Cancel the live analysis of this comparison (the machine's own CANCEL; the same control as the Processes drawer's). */
export async function cancelAnalysis(base: string, head: string, plan?: string | null): Promise<boolean> {
  try {
    const body = await postJson<{ ok?: boolean }>('/api/review/cancel', { base, head, ...(plan ? { plan } : {}) });
    return !!body.ok;
  } catch {
    return false;
  }
}
