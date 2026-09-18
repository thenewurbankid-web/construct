'use client';

import { useMemo } from 'react';
import { buildMachineFlow } from '../domain/MachineGraph';
import type { WorkflowMachine } from '../types';

// Re-exported so components (StateFlowNode) can type against the graph's
// node-data shape without importing domain directly — COMPONENT-003 only
// lets a component import a hook.
export type { StateNodeData } from '../domain/MachineGraph';

/** React Flow nodes/edges for one extracted machine — derived from the
 * machine on every change, never persisted. */
export function useMachineFlow(machine: WorkflowMachine) {
  return useMemo(() => buildMachineFlow(machine), [machine]);
}
