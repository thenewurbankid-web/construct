import type { NavView, Trail, TrailStep } from '../types';
import { fileTitle, startTrail } from './TrailHistory.ts';

// Pure (DOMAIN-001): adding to the trail.

/** Follow a reference: the new step goes after the current one and everything after the current one is dropped. */
export function pushStep(trail: Trail, step: TrailStep): Trail {
  const steps = [...trail.steps.slice(0, trail.index + 1), step];
  return { steps, index: steps.length - 1 };
}

export const currentStep = (t: Trail): TrailStep | null => t.steps[t.index] ?? null;

/** Replace the first step's view (the page was re-read after an edit) and keep the rest of the trail. */
export function refreshRoot(trail: Trail, view: NavView): Trail {
  if (trail.steps.length === 0) return startTrail(view);
  const [first, ...rest] = trail.steps;
  return { ...trail, steps: [{ ...first, view, name: fileTitle(view.path) }, ...rest] };
}
