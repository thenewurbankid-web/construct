// Pure (DOMAIN-001): the GitHub connection for private repositories (#638) as the screens show it. The connection
// itself (and its token) lives only in ui/server's memory; the client sees a status and a list of repository names.
import type { CloneAuthMode, GithubPanelView, GithubStatus } from '../types.ts';

/** How this clone is authorised: "Use my GitHub login" is the default whenever a connection exists; the pasted token is
 * the fallback (and the only way when the connection is off or not made). A stale choice of the login with no
 * connection falls back to the token. */
export function effectiveAuthMode(status: GithubStatus | null, choice: CloneAuthMode | null): CloneAuthMode {
  const usable = !!status && status.enabled && status.connected;
  if (!usable) return 'token';
  return choice ?? 'login';
}

/** What to draw: nothing when the feature is off (or not yet known), else the connection in one line. */
export function githubPanelView(status: GithubStatus | null): GithubPanelView {
  if (!status || !status.enabled) return { visible: false, connected: false, summary: '', login: null };
  if (!status.connected) return { visible: true, connected: false, summary: 'Not connected', login: null };
  const login = status.login ?? null;
  return { visible: true, connected: true, summary: login ? `Connected as ${login}` : 'Connected', login };
}
