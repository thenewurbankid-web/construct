import { API_BASE } from '@/lib/apiBase';

// The two ways to obtain a session. Split from AuthApi.ts for MODULE-001
// (one primary module per file).

/** Start the real GitHub round trip. A full-page navigation, not a fetch:
 * the flow ends in a redirect back from github.com, which an XHR cannot
 * follow and which must land in the address bar to set the cookie. */
export function startGithubLogin(loginPath: string): void {
  window.location.href = `${API_BASE}${loginPath}`;
}

/** The e2e escape hatch (`POST /auth/test-login`). It mints an ordinary
 * signed session for the server's configured `CONSTRUCT_AUTH_TEST_USER`;
 * on any server that has not enabled it, this 404s. It is called from a
 * real button on the login screen on purpose — the e2e suite then proves
 * the real gate by genuinely logging in and holding a genuine cookie,
 * rather than by a hidden hook the product code does not have. */
export async function testLogin(): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/auth/test-login`, { method: 'POST', credentials: 'include' });
  try {
    return (await res.json()) as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: `The test login is not available on this server (HTTP ${res.status}).` };
  }
}
