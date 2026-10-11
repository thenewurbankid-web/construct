// Pure (DOMAIN-001): the Auto controls the person sees for a run, as labels and actions to call.
import { isActive } from './AutoStatus.ts';
import type { AutoButton, RunState } from '../types.ts';

export const SPEED_OPTIONS = [
  { value: 0.5, label: 'Slow' },
  { value: 1, label: 'Normal' },
  { value: 2, label: 'Fast' },
];

/** Pause while playing; Go on and One step while paused; Stop while the run is going. */
export function runButtons(run: RunState | null): AutoButton[] {
  if (!run || !isActive(run)) return [];
  const out: AutoButton[] = [];
  if (run.status === 'playing') out.push({ id: 'pause', label: 'Pause' });
  if (run.status === 'paused') out.push({ id: 'resume', label: 'Go on' }, { id: 'step', label: 'One step' });
  out.push({ id: 'stop', label: 'Stop' });
  return out;
}
