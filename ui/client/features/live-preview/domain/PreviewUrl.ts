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

/** The Cockpit previews the dev server of the project it opened, never a site elsewhere (#378): only an address
 * on this machine (`localhost`, `127.0.0.1`, `::1`, or a `*.localhost` name) may be framed. */
export function isLocalPreviewUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}
