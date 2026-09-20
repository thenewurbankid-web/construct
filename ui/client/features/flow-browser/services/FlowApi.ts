import { API_BASE } from '@/lib/apiBase';
import type { FlowData } from '../types';

/** GET /api/flow/:feature (read-only). The server checks the name against the project's real features. */
export async function fetchFlow(feature: string): Promise<FlowData> {
  const res = await fetch(`${API_BASE}/api/flow/${encodeURIComponent(feature)}`, { credentials: 'include' });
  const body = (await res.json().catch(() => ({}))) as Partial<FlowData> & { error?: string };
  if (!res.ok || body.ok !== true) throw new Error(body.error || `The flow could not be read (${res.status}).`);
  return body as FlowData;
}

/** The current project directory, used only as the key the Files | Flow choice is remembered under. */
export async function fetchProjectKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/settings`, { credentials: 'include' });
    const settings = (await res.json()) as { projectDir?: string };
    return settings.projectDir ?? null;
  } catch {
    return null;
  }
}
