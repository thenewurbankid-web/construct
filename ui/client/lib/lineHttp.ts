import { getJson, postJson, sendJson } from '@/lib/http';
import type { LineHttp, LineRefusal, PlanView } from './lineContract';

// The client's one mirror of LINE_API (packages/engine/line/contract.mjs), served by ui/server's lineApi.mjs,
// lineOpsApi.mjs and lineRenderApi.mjs under /api/line. A refusal arrives as 400 {ok: false, sentence, code};
// getJson/postJson read the body whatever the status, so a refusal reaches the screen as its sentence. Every Line
// change is a plan step (cp1): add it, a person approves it, then it runs (Construct's writer on the server). There
// are no direct write routes: Approve and Run carry the approval token GET /api/line/plan hands this page.

/** The approval token from the last GET /api/line/plan (it changes when the server restarts). */
let approvalToken: string | null = null;

async function getPlan(): Promise<PlanView | LineRefusal> {
  const body = await getJson<PlanView | LineRefusal>('/api/line/plan');
  if (body && body.ok && typeof body.approvalToken === 'string') approvalToken = body.approvalToken;
  return body;
}

/** A POST only a person makes (approve, run): with the approval token, read once when the page has none yet, and
 * read again once when the server refuses it (it restarted, so its token changed). */
async function personPost<T>(path: string, body: unknown): Promise<T> {
  if (!approvalToken) await getPlan();
  const send = () => sendJson<T>('POST', path, body, approvalToken ? { 'x-line-approval': approvalToken } : {});
  let r = await send();
  if (r.status === 403 && (r.body as { code?: string })?.code === 'NO_APPROVAL') {
    await getPlan();
    r = await send();
  }
  return r.body;
}

export const lineHttp: LineHttp = {
  getProject: () => getJson('/api/line/project'),
  getPageTree: (file) => getJson(`/api/line/page-tree?file=${encodeURIComponent(file)}`),
  render: (file, props) => {
    const q = new URLSearchParams({ file });
    if (props !== undefined) q.set('props', props);
    return getJson(`/api/line/render?${q.toString()}`);
  },
  getFeature: (name) => getJson(`/api/line/feature?name=${encodeURIComponent(name)}`),
  getWorkspace: () => getJson('/api/line/workspace'),
  getWorkflows: (feature) => getJson(`/api/line/workflows?feature=${encodeURIComponent(feature)}`),
  setWorkspace: (req) => postJson('/api/line/workspace', req),
  getPlan,
  addPlanStep: (req) => postJson('/api/line/plan/step', req),
  approvePlanStep: (stepId) => personPost('/api/line/plan/approve', Array.isArray(stepId) ? { stepIds: stepId } : { stepId }),
  runPlan: (stepId) => personPost('/api/line/plan/run', stepId === undefined ? {} : { stepId }),
  getTools: () => getJson('/api/line/tools'),
  getDraftStatus: () => getJson('/api/line/plan/draft'),
  draft: (request) => postJson('/api/line/plan/draft', { request }),
  addDraftRoute: (request, routeId, from) => postJson('/api/line/plan/draft/add', from === undefined ? { request, routeId } : { request, routeId, from }),
  answerDraft: (word, key) => postJson('/api/line/plan/draft/answer', { word, key }),
  getFragments: (file) => getJson(`/api/line/fragments?file=${encodeURIComponent(file)}`),
  importFolders: () => getJson('/api/line/import/folders'),
  importScan: (req) => postJson('/api/line/import/scan', req),
  importPlan: (req) => postJson('/api/line/import/plan', req),
  newProject: (req) => postJson('/api/line/new-project', req),
  getAiProfiles: () => getJson('/api/line/ai-profiles'),
  trace: (req) => postJson('/api/line/trace', req),
  getImportAgent: (folder) => getJson(`/api/line/import-agent?folder=${encodeURIComponent(folder)}`),
  startImportAgent: (folder, route) => postJson('/api/line/import-agent/start', route ? { folder, route } : { folder }),
  resumeImportAgent: (folder) => postJson('/api/line/import-agent/resume', { folder }),
  pauseImportAgent: (folder) => postJson('/api/line/import-agent/pause', { folder }),
  editImportStep: (req) => postJson('/api/line/import-agent/step', req),
  answerImportAgent: (req) => postJson('/api/line/import-agent/answer', req),
};
