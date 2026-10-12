// Pure (DOMAIN-001): the New project question series: which questions there are, and in what order.
import type { NewProjectStep } from '../types.ts';

export const NEW_PROJECT_STEPS: ReadonlyArray<{ id: NewProjectStep; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'kind', label: 'Kind' },
  { id: 'confirm', label: 'Create' },
];

/** The step after `step` (the last one stays). */
export function nextStep(step: NewProjectStep): NewProjectStep {
  const i = NEW_PROJECT_STEPS.findIndex((s) => s.id === step);
  return NEW_PROJECT_STEPS[Math.min(i + 1, NEW_PROJECT_STEPS.length - 1)].id;
}

/** The step before `step` (the first one stays). */
export function previousStep(step: NewProjectStep): NewProjectStep {
  const i = NEW_PROJECT_STEPS.findIndex((s) => s.id === step);
  return NEW_PROJECT_STEPS[Math.max(i - 1, 0)].id;
}

