/** Recent server/command output is polled while the Logs tab is mounted. */
export const LOGS_POLL_MS = 2500;

/** Timers are external effects (SERVICE-001): the Logs polling loop lives here, not in its hook.
 * Refresh once now, then every `intervalMs`; the returned function stops it. */
export function watchLogs(refresh: () => unknown, intervalMs: number = LOGS_POLL_MS): () => void {
  refresh();
  const id = setInterval(refresh, intervalMs);
  return () => clearInterval(id);
}
