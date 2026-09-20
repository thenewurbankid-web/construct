// Pure (DOMAIN-001): the words for a step, and for who does it.
import type { StepExecutor, StepStatus } from '../types.ts';

/** Who does a step (#287): a block, a local model, or the person. */
export function executorLabel(executor: StepExecutor): string {
  if (executor === 'local-model') return 'Local model';
  if (executor === 'user') return 'You';
  return 'Deterministic';
}

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  'awaiting-user': 'Waiting for you',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};
