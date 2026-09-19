// Pure (DOMAIN-001)
/** Only http(s) URLs may be framed; returns the normalised URL or null. */
export function normalizePreviewUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
