/** How often the screen asks whether the plan's files have reached the project, while the plan is approved and they have not (#653). */
export const APPLIED_POLL_MS = 2000;

/** Timers are external effects (SERVICE-001): the loop lives here, not in its hook. Calls `check` every `intervalMs`; the returned function stops it. */
export function watchPlanApplied(check: () => unknown, intervalMs: number = APPLIED_POLL_MS): () => void {
  const id = setInterval(() => void check(), intervalMs);
  return () => clearInterval(id);
}
