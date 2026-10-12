// Pure (DOMAIN-001): the "From GitHub" question series: which questions there are, and in what order.
import type { CloneStep } from '../types.ts';

export const CLONE_STEPS: ReadonlyArray<{ id: CloneStep; label: string }> = [
  { id: 'link', label: 'Link' },
  { id: 'private', label: 'Private?' },
  { id: 'confirm', label: 'Bring it in' },
];

export function nextCloneStep(step: CloneStep): CloneStep {
  const i = CLONE_STEPS.findIndex((s) => s.id === step);
  return CLONE_STEPS[Math.min(i + 1, CLONE_STEPS.length - 1)].id;
}

export function previousCloneStep(step: CloneStep): CloneStep {
  const i = CLONE_STEPS.findIndex((s) => s.id === step);
  return CLONE_STEPS[Math.max(i - 1, 0)].id;
}

