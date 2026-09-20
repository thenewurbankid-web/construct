import type { Trail, TrailItem } from '../types';

// Pure (DOMAIN-001): a long trail folds its middle so where you are stays visible.

/** Past this many steps the middle of the trail folds into an "..." menu. */
export const MAX_VISIBLE_STEPS = 6;

/** What to draw. Up to `max` steps every step shows; beyond that the first step, the last step and the
 * current step (with a neighbour either side) show, and each gap becomes one fold. */
export function foldTrail(trail: Trail, max: number = MAX_VISIBLE_STEPS): TrailItem[] {
  const n = trail.steps.length;
  if (n <= max) return trail.steps.map((step, index) => ({ kind: 'step', index, step }));
  const keep = new Set<number>([0, n - 1, trail.index - 1, trail.index, trail.index + 1]);
  const items: TrailItem[] = [];
  let hidden: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep.has(i)) {
      if (hidden.length) items.push({ kind: 'fold', hidden });
      hidden = [];
      items.push({ kind: 'step', index: i, step: trail.steps[i] });
    } else hidden.push(i);
  }
  return items;
}
