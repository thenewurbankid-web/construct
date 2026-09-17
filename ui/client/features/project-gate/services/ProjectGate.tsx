import { API_BASE } from '@/lib/apiBase';
import type { ProjectStatus } from '../types';

/** Real network I/O lives here, not in the hook or the page (SERVICE-*) —
 * thin wrappers over ui/server's REST endpoints (see ui/server/src/index.mjs).
 * `init()` runs `construct init` against whichever project directory is
 * currently selected. */
export async function fetchProjectStatus(): Promise<ProjectStatus> {
  const res = await fetch(`${API_BASE}/api/settings`);
  return res.json();
}

export async function initProject(): Promise<ProjectStatus & { error?: string }> {
  const res = await fetch(`${API_BASE}/api/init`, { method: 'POST' });
  return res.json();
}
