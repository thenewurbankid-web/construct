'use client';

import { useMemo } from 'react';
import { describeBehavior } from '../domain/MachineBehavior';
import type { WorkflowMachine } from '../types';

// Re-exported so the panel can type against the behavior shape without
// importing domain directly (COMPONENT-003 only lets a component import a hook).
export type { MachineBehavior, NamedUsage } from '../domain/MachineBehavior';

/** Context fields, named actions/guards and their usages for one machine --
 * derived from the extracted machine on every change, never persisted. */
export function useMachineBehavior(machine: WorkflowMachine) {
  return useMemo(() => describeBehavior(machine), [machine]);
}
