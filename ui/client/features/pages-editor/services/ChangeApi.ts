// #381 — Inspector "Change" tab: the dry-run preview (never writes) and the one plan/run call
// that starts the mechanical refactor, reusing the same server routes Plan mode uses.
import { getJson, postJson } from '@/lib/http';

export type RefactorPreview = {
  ok: boolean;
  error?: string;
  verb?: 'move' | 'rename';
  argv?: string[];
  from?: string;
  to?: string;
  importersUpdated?: number;
  engine?: string;
  note?: string;
  files?: string[];
  dryRun?: true;
};

export const previewMove = (feature: string, name: string, from: string, to: string) =>
  postJson<RefactorPreview>('/api/plan/refactor-preview', { verb: 'move', feature, name, from, to });

export const previewRename = (feature: string, name: string, newName: string, layer: string) =>
  postJson<RefactorPreview>('/api/plan/refactor-preview', { verb: 'rename', feature, name, newName, layer });

export type LayerInfo = { name: string; canImport: string[] };

/** The project's own layers (#381's Move argument is a closed list, never free text), read once per
 * project from the same `/api/plan/context` Plan mode uses. */
export const getLayers = () => getJson<{ ok?: boolean; constraints?: { layers: LayerInfo[] } }>('/api/plan/context');

export type ChangeStep = {
  id: string;
  title: string;
  flow: 'refactor.move' | 'refactor.rename';
  args: Record<string, string>;
  executor: 'deterministic';
  touches: { features: string[]; files: { path: string; change: 'modify' | 'create' | 'delete' }[] };
};

export type ChangePlan = { version: 1; ticket: { source: 'text'; title: string }; steps: ChangeStep[] };

export const runChange = (plan: ChangePlan) =>
  postJson<{ ok?: boolean; processId?: string; error?: string }>('/api/plan/run', { plan });
