import type { Trail } from '../types';

// Pure (DOMAIN-001): which arrows are enabled.

export const canBack = (t: Trail): boolean => t.index > 0;
export const canForward = (t: Trail): boolean => t.index >= 0 && t.index < t.steps.length - 1;
