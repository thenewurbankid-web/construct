import { API_BASE } from '@/lib/apiBase';
import type { OpenProjectResult, ProjectStatus } from '../types';

/** Real network I/O lives here, not in the hook or the page (SERVICE-*) —
 * thin wrappers over ui/server's REST endpoints (see ui/server/src/index.mjs).
 * `init()` runs `construct init` against whichever project directory is
 * currently selected. */
export async function fetchProjectStatus(): Promise<ProjectStatus> {
  const res = await fetch(`${API_BASE}/api/settings`, { credentials: 'include' });
  return res.json();
}

export async function initProject(): Promise<ProjectStatus & { error?: string }> {
  const res = await fetch(`${API_BASE}/api/init`, { method: 'POST', credentials: 'include' });
  return res.json();
}

/** #365: open a folder from the workspace as the project. The server refuses anything outside the workspace
 * (with a stable `code`); only `projectDir` is sent, other settings are left alone. */
export async function openProject(projectDir: string): Promise<OpenProjectResult> {
  const res = await fetch(`${API_BASE}/api/settings`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectDir }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  return res.ok && body.ok !== false ? { ok: true } : { ok: false, error: body.error ?? 'Could not open that folder.' };
}
