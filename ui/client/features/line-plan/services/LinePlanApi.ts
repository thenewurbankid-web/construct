import { lineHttp } from '@/lib/lineHttp';
import { toPlanAnswer } from '../domain/PlanAnswer';
import type { LinePlanApi, PlanAnswer } from '../types';

// The Plan panel's use of the shared LINE_API mirror (lib/lineHttp.ts): GET /api/line/plan and the three plan writes.
// A refusal (400/409 with {ok: false, sentence}) or a silent server is one sentence.
async function send(call: () => Promise<unknown>): Promise<PlanAnswer> {
  try {
    return toPlanAnswer(await call());
  } catch {
    return { ok: false, sentence: 'The Cockpit server did not answer; nothing was changed.' };
  }
}

export const linePlanApi: LinePlanApi = {
  getPlan: () => send(() => lineHttp.getPlan()),
  addStep: (req) => send(() => lineHttp.addPlanStep(req)),
  approve: (stepId) => send(() => lineHttp.approvePlanStep(stepId)),
  run: (stepId) => send(() => lineHttp.runPlan(stepId)),
};
