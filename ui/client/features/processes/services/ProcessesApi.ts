import { getJson } from '@/lib/http';
import type { ProcessDetail, ProcessSummary } from '../types';

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
