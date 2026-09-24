import type { PageChange } from '../types';

export const PAGE_CHANGE_POLL_MS = 1500;

/** Timers are external effects (SERVICE-001): the external-change loop lives here, not in its hook.
 * Read the open file's last external change once now, then every `intervalMs`, handing each answer to
 * `onChange`; a read that fails is ignored and an answer that lands after the returned stop function ran is dropped. */
export function watchPageChange(
  read: () => Promise<{ change?: PageChange | null }>,
  onChange: (change: PageChange | null) => void,
  intervalMs: number = PAGE_CHANGE_POLL_MS,
): () => void {
  let cancelled = false;
  const poll = () => {
    read()
      .then((r) => { if (!cancelled) onChange(r.change ?? null); })
      .catch(() => {});
  };
  poll();
  const timer = setInterval(poll, intervalMs);
  return () => { cancelled = true; clearInterval(timer); };
}
