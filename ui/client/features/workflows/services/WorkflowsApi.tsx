import { getJson } from '@/lib/http';
import type { WorkflowFileMachines } from '../types';

// Read-only, scoped server-side to features/<feature>/workflows/ (see
// ui/server/src/workflowsViewer.mjs). Every response is extracted live from
// the real source file — nothing here caches or persists a machine.
export const getWorkflowFeatures = () => getJson<{ features: string[] }>('/api/workflows/features');

export const getWorkflowFiles = (feature: string) =>
  getJson<{ files: string[] }>(`/api/workflows?feature=${encodeURIComponent(feature)}`);

export const getWorkflowMachines = (feature: string, file: string) =>
  getJson<WorkflowFileMachines & { ok?: false; error?: string }>(
    `/api/workflows/machines?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}`,
  );
