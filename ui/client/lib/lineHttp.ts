import { getJson, postJson } from '@/lib/http';
import type { LineHttp } from './lineContract';

// The client's one mirror of LINE_API (packages/engine/line/contract.mjs), served by ui/server's lineApi.mjs,
// lineOpsApi.mjs and lineRenderApi.mjs under /api/line. A refusal arrives as 400 {ok: false, sentence, code};
// getJson/postJson read the body whatever the status, so a refusal reaches the screen as its sentence. Every Line
// change is a plan step (cp1): add it, a person approves it, then it runs (Construct's writer on the server).
export const lineHttp: LineHttp = {
  getProject: () => getJson('/api/line/project'),
  getPageTree: (file) => getJson(`/api/line/page-tree?file=${encodeURIComponent(file)}`),
  setPageProp: (req) => postJson('/api/line/page-prop', req),
  baseOn: (req) => postJson('/api/line/base-on', req),
  promote: (req) => postJson('/api/line/promote', req),
  render: (file, props) => {
    const q = new URLSearchParams({ file });
    if (props !== undefined) q.set('props', props);
    return getJson(`/api/line/render?${q.toString()}`);
  },
  getPlan: () => getJson('/api/line/plan'),
  addPlanStep: (req) => postJson('/api/line/plan/step', req),
  approvePlanStep: (stepId) => postJson('/api/line/plan/approve', { stepId }),
  runPlan: (stepId) => postJson('/api/line/plan/run', stepId === undefined ? {} : { stepId }),
};
