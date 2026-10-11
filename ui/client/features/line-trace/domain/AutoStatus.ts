// Pure (DOMAIN-001): where a run stands, and Auto's pace.
import type { RunState } from '../types.ts';

/** Whether the run is still going (or waiting), so its controls show. */
export function isActive(run: RunState | null): boolean {
  return run !== null && (run.status === 'playing' || run.status === 'paused' || run.status === 'waiting');
}

/** Whether the player should make the current move now. */
export function shouldMove(run: RunState | null): boolean {
  return run !== null && (run.status === 'playing' || (run.status === 'paused' && run.stepping));
}

/** How long the cursor takes to reach a control, in ms. Auto alone has no show and goes straight on. */
export function delayFor(speed: number, show: boolean): number {
  return show ? Math.round(900 / speed) : 40;
}
