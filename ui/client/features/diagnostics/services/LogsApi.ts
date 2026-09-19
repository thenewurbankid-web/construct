import { getJson } from '@/lib/http';
import type { LogEntry } from '../types';

/** Recent server/command output newer than `since` (ui/server GET /api/logs), or null when unreachable. */
export async function fetchLogs(since: number): Promise<LogEntry[] | null> {
  try {
    const body = await getJson<{ ok?: boolean; entries?: LogEntry[] }>(`/api/logs?since=${Math.max(0, Math.floor(since))}`);
    return body.ok ? (body.entries ?? []) : null;
  } catch {
    return null;
  }
}
