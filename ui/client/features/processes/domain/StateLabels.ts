// Pure (DOMAIN-001): the words for a whole process's state.
import type { TopState } from '../types.ts';

export const STATE_LABEL: Record<TopState, string> = {
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
