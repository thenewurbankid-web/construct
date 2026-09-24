/** Timers are external effects (SERVICE-001): the dev server status loop lives here, not in its hook.
 * Refresh once now, then every `intervalMs`; the returned function stops it. */
export function watchDevServerStatus(refresh: () => unknown, intervalMs: number): () => void {
  refresh();
  const id = setInterval(refresh, intervalMs);
  return () => clearInterval(id);
}
