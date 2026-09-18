import { getJson } from '@/lib/http';
import type { WorkflowNarrative } from '../types';

// Epic #185: the open workflow file explained in plain English (narrative,
// scenarios, health findings) — derived server-side from the real source on
// every call (GET /api/workflows/narrative); nothing is cached or stored.
export const getWorkflowNarrative = (feature: string, file: string) =>
  getJson<WorkflowNarrative & { ok?: false; error?: string }>(
    `/api/workflows/narrative?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}`,
  );
