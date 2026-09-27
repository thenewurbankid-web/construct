import { getJson } from '@/lib/http';
import type { GcReport, ProcessDetail, ProcessSummary } from '../types';

/** The process list for the current project (ui/server GET /api/processes), or null when unreachable. */
export async function fetchProcesses(): Promise<ProcessSummary[] | null> {
  try {
    const body = await getJson<{ ok?: boolean; processes?: ProcessSummary[] }>('/api/processes');
    return body.ok ? (body.processes ?? []) : null;
  } catch {
    return null;
  }
}

export async function fetchProcess(id: string): Promise<ProcessDetail | null> {
  try {
    const body = await getJson<{ ok?: boolean; process?: ProcessDetail }>(`/api/processes/${encodeURIComponent(id)}`);
    return body.ok && body.process ? body.process : null;
  } catch {
    return null;
  }
}

/** #416 -- the dry-run `construct process gc` report taken when the project was opened, or null when there is
 * nothing to report (or the server could not be reached). */
export async function fetchGc(): Promise<GcReport | null> {
  try {
    const body = await getJson<{ ok?: boolean; gc?: GcReport | null }>('/api/processes/gc');
    return body.ok ? (body.gc ?? null) : null;
  } catch {
    return null;
  }
}
