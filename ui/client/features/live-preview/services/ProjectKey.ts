import { getJson } from '@/lib/http';

/** The open project's directory, used by this feature only as the key its preview
 * choices are remembered under (never shown, never sent anywhere else). Null when
 * no project is open or the server cannot be reached — the choices then fall back
 * to a shared default rather than failing. */
export async function fetchPreviewProjectKey(): Promise<string | null> {
  const settings = await getJson<{ projectDir?: string }>('/api/settings').catch(() => null);
  return settings?.projectDir ?? null;
}
