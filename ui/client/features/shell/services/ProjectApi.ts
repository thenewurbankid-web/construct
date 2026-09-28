import { getJson, postJson } from '@/lib/http';

/** The current project directory (ui/server GET /api/settings). */
export async function fetchProjectDir(): Promise<string | null> {
  try {
    const settings = await getJson<{ projectDir?: string }>('/api/settings');
    return settings.projectDir ?? null;
  } catch {
    return null;
  }
}

/** #541: which mode the open project runs core activities in, `'engine'` (default, in-process) or
 * `'cli'` (the real construct binary as a subprocess). Null when no project is open or the value
 * can't be read. */
export async function fetchExecutionMode(): Promise<string | null> {
  try {
    const settings = await getJson<{ executionMode?: string | null }>('/api/settings');
    return settings.executionMode ?? null;
  } catch {
    return null;
  }
}

/** Points the whole UI at another local project (POST /api/settings; only
 * projectDir is sent, other settings are left alone). Returns an error message or null. */
export async function closeProjectDir(): Promise<string | null> {
  const result = await postJson<{ error?: string }>('/api/settings', { closeProject: true });
  return result.error ?? null;
}

export async function switchProjectDir(projectDir: string): Promise<string | null> {
  const result = await postJson<{ error?: string }>('/api/settings', { projectDir });
  return result.error ?? null;
}
