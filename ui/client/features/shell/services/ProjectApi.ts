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

/** Points the whole UI at another local project (POST /api/settings; only
 * projectDir is sent, other settings are left alone). Returns an error message or null. */
export async function switchProjectDir(projectDir: string): Promise<string | null> {
  const result = await postJson<{ error?: string }>('/api/settings', { projectDir });
  return result.error ?? null;
}
