import { getJson, sendJson } from '@/lib/http';
import type { KnowsHttp } from './lineKnowsContract';

// "What Line knows": the client's routes (packages/engine/line/knows/contract.mjs KNOWS_API), served by ui/server's
// lineKnowsApi.mjs and im3's lineMemoryApi.mjs. A refusal arrives as {ok: false, sentence, code}; getJson/postJson read
// the body whatever the status, so the screen shows its sentence. Changes are NOT written here: the Change tab adds
// plan steps through lib/lineHttp.ts and a person approves them.

/** The approval token GET /api/line/plan hands a person's Cockpit page (every memory change and the export carry it). */
async function approval(): Promise<Record<string, string>> {
  const plan = await getJson<{ ok?: boolean; approvalToken?: string }>('/api/line/plan');
  const token = plan && typeof plan.approvalToken === 'string' ? plan.approvalToken : '';
  return token ? { 'x-line-approval': token } : {};
}

/** A memory change or the export: a person's act, so it carries the approval token; the body is the answer. */
async function person<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  return (await sendJson<T>(method, path, body, await approval())).body;
}

export const lineKnowsHttp: KnowsHttp = {
  graph: (focus) => getJson(focus ? `/api/line/graph?focus=${encodeURIComponent(focus)}` : '/api/line/graph'),
  changes: (focus) => getJson(focus ? `/api/line/graph/changes?focus=${encodeURIComponent(focus)}` : '/api/line/graph/changes'),
  stats: () => getJson('/api/line/graph/stats'),
  memorySteps: () => getJson('/api/line/memory'),
  memoryRecords: (step) => getJson(step ? `/api/line/memory/records?step=${encodeURIComponent(step)}` : '/api/line/memory/records'),
  memoryEdit: (id, chosen) => person('POST', '/api/line/memory/edit', { id, chosen }),
  memoryForgetStep: (step) => person('POST', '/api/line/memory/forget', { step }),
  memoryForgetRecord: (id) => person('POST', '/api/line/memory/forget-record', { id }),
  memoryForgetAll: () => person('POST', '/api/line/memory/forget-all', {}),
  memoryExport: () => person('GET', '/api/line/memory/export'),
  memoryImport: (file) => person('POST', '/api/line/memory/import', file),
  memoryEmbeddings: (on) => person('POST', '/api/line/memory/embeddings', { on }),
};
