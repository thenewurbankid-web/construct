import { postJson } from '@/lib/http';
import type { NewProjectFramework, NewProjectResult } from '../types';

/** Real network I/O for "New project" (SERVICE-*): a thin wrapper over ui/server's POST /api/projects. The client
 * sends a NAME and a framework only; the server derives the path, refuses a bad or taken name (creating nothing),
 * runs `construct init` and opens the result. Failures come back as `{ ok: false, error }`, never thrown. */
type Body = { ok?: boolean; error?: string; name?: string; projectDir?: string | null };

export async function createProject(name: string, framework: NewProjectFramework): Promise<NewProjectResult> {
  try {
    const body = await postJson<Body>('/api/projects', { name, framework });
    return body.ok && body.projectDir ? { ok: true, name: body.name ?? name, dir: body.projectDir } : { ok: false, error: body.error ?? 'The project could not be created.' };
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }
}
