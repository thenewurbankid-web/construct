import type { Trail } from '../types';

// Pure (DOMAIN-001): moving along the trail. Each move clamps at the ends and returns the same trail
// when there is nowhere to go.

export const goBack = (t: Trail): Trail => (t.index > 0 ? { ...t, index: t.index - 1 } : t);
export const goForward = (t: Trail): Trail => (t.index >= 0 && t.index < t.steps.length - 1 ? { ...t, index: t.index + 1 } : t);
export const goTo = (t: Trail, i: number): Trail => (Number.isInteger(i) && i >= 0 && i < t.steps.length ? { ...t, index: i } : t);
