/** While the server is coming up the card is watched closely; otherwise it is only kept honest (a branch switch, a crash). */
export const POLL_STARTING_MS = 600;
export const POLL_MS = 2000;

/** How long to wait between status reads, given the state the card is showing (undefined before the first read). */
export function pollIntervalMs(state: string | undefined): number {
  return state === 'starting' ? POLL_STARTING_MS : POLL_MS;
}
