/** How often the Cockpit re-reads the session. The coalescing window closes on the SERVER's timer,
 * so without a poll the indicator would go stale at exactly the moment a commit happens. */
export const GIT_SESSION_POLL_MS = 1500;

/** Timers are external effects (SERVICE-001): the session polling loop lives here, not in its hook.
 * Refresh once now, then every `intervalMs`; the returned function stops it. */
export function watchGitSession(refresh: () => unknown, intervalMs: number = GIT_SESSION_POLL_MS): () => void {
  refresh();
  const id = setInterval(refresh, intervalMs);
  return () => clearInterval(id);
}
