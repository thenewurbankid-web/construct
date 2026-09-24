import { getJson } from '@/lib/http';
import type { ProjectTree } from '../types';

export type ProjectTreeResult = ({ ok: true } & ProjectTree) | { ok: false; error: string };

/** Real network I/O: one directory of the open project (ui/server's GET /api/project/tree, contained to the
 * project). Failures come back as `{ ok: false, error }`, never thrown. */
export async function fetchProjectTree(path: string): Promise<ProjectTreeResult> {
  try {
    return await getJson<ProjectTreeResult>(`/api/project/tree${path ? `?path=${encodeURIComponent(path)}` : ''}`);
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }
}
