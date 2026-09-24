/** How often a live test run is re-read (#305). */
export const RUN_POLL_MS = 1000;

/** Timers are external effects (SERVICE-001): the live-run loop lives here, not in its hook.
 * Refresh every `intervalMs` (the caller has just read the run, so no read now); the returned function stops it. */
export function watchLiveRun(refresh: () => unknown, intervalMs: number = RUN_POLL_MS): () => void {
  const id = setInterval(() => void refresh(), intervalMs);
  return () => clearInterval(id);
}
