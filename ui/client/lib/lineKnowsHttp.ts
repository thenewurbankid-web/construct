import { getJson, postJson, sendJson } from '@/lib/http';
import type { KnowsHttp } from './lineKnowsContract';

// "What Line knows": the client's routes (packages/engine/line/knows/contract.mjs KNOWS_API), served by ui/server's
// lineKnowsApi.mjs and im3's lineMemoryApi.mjs. A refusal arrives as {ok: false, sentence, code}; getJson/postJson read
// the body whatever the status, so the screen shows its sentence. Changes are NOT written here: the Change tab adds
// plan steps through lib/lineHttp.ts and a person approves them.

/** im3's POST /memory/forget is a person's act: it carries the approval token GET /api/line/plan hands the page. */
async function forgetStep(step: string) {
  const plan = await getJson<{ ok?: boolean; approvalToken?: string }>('/api/line/plan');
  const token = plan && typeof plan.approvalToken === 'string' ? plan.approvalToken : '';
  return (await sendJson('POST', '/api/line/memory/forget', { step }, token ? { 'x-line-approval': token } : {})).body as Awaited<ReturnType<KnowsHttp['memoryForgetStep']>>;
}

export const lineKnowsHttp: KnowsHttp = {
  graph: (focus) => getJson(focus ? `/api/line/graph?focus=${encodeURIComponent(focus)}` : '/api/line/graph'),
  changes: () => getJson('/api/line/graph/changes'),
  stats: () => getJson('/api/line/graph/stats'),
  memorySteps: () => getJson('/api/line/memory'),
  memoryRecords: (step) => getJson(step ? `/api/line/memory/records?step=${encodeURIComponent(step)}` : '/api/line/memory/records'),
  memoryEdit: (id, chosen) => postJson('/api/line/memory/edit', { id, chosen }),
  memoryForgetStep: forgetStep,
  memoryForgetRecord: (id) => postJson('/api/line/memory/forget-record', { id }),
  memoryForgetAll: () => postJson('/api/line/memory/forget-all', {}),
  memoryExport: () => getJson('/api/line/memory/export'),
  memoryImport: (file) => postJson('/api/line/memory/import', file),
  memoryEmbeddings: (on) => postJson('/api/line/memory/embeddings', { on }),
};
