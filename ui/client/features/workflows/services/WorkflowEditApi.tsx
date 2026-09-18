import { postJson } from '@/lib/http';
import type { WorkflowFileMachines } from '../types';

// #61 - one visual edit. commit:false = preview (patched source back, nothing
// written); commit:true = re-applied server-side, hash-checked and
// enforcement-gated before the write. The client never sends file content.
export type WorkflowEditResponse =
  | { ok: true; before: string; after: string; contentHash: string }
  | (WorkflowFileMachines & { ok: true; violations?: unknown[] })
  | { ok: false; error: string; violations?: { rule?: string; message?: string }[] };

export const postWorkflowEdit = (body: Record<string, unknown>) => postJson<WorkflowEditResponse>('/api/workflows/edit', body);
