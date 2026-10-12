import { lineHttp } from '@/lib/lineHttp';
import { notifyLinePlanChanged } from '@/lib/linePlanRun';
import type { LineRefusal, PlanStepRequest, PlanView } from '@/lib/lineContract';

// The Change tab's use of the plan API (lib/lineHttp.ts): a change becomes one plan step, a person approves it, then it
// runs through Construct's writer on the server. There is no other write route. In mock mode the same three calls
// answer from a pretend plan, and an approval tells the page's mock that the change landed.

/** The three plan calls the Change tab makes. */
export type ChangePlanApi = {
  add: (step: PlanStepRequest) => Promise<PlanView | LineRefusal>;
  approve: (stepId: string) => Promise<PlanView | LineRefusal>;
  run: (stepId: string) => Promise<PlanView | LineRefusal>;
};

/** The real plan (Cockpit's server). Any open Plan panel hears about a run. */
export const realChangePlan: ChangePlanApi = {
  add: (step) => lineHttp.addPlanStep(step),
  approve: (stepId) => lineHttp.approvePlanStep(stepId),
  run: async (stepId) => { const r = await lineHttp.runPlan(stepId); notifyLinePlanChanged(); return r; },
};

/** A pretend plan for mock mode: steps wait, an approval runs them, `landed` tells the mock which change it was. */
export function mockChangePlan(landed: (stepId: string) => void): ChangePlanApi {
  let n = 0;
  const steps = new Map<string, PlanStepRequest & { state: 'waiting' | 'ready' | 'done' }>();
  const view = (stepId?: string): PlanView => ({
    ok: true, sessionId: 'mock', planId: 'mock', version: n, status: 'open', store: { linked: false, sentence: 'Mock mode: nothing is saved.' },
    steps: [...steps.entries()].map(([id, s], i) => ({ id, n: i + 1, tool: s.tool, args: s.args ?? {}, why: '', kind: 'write', state: s.state, sentence: `${s.tool} (mock).`, gap: [], result: null, error: null })) as PlanView['steps'],
    ...(stepId ? { stepId } : {}),
  });
  return {
    add: async (step) => { n += 1; const id = `mock-${n}`; steps.set(id, { ...step, state: 'waiting' }); return view(id); },
    approve: async (id) => { const s = steps.get(id); if (s) s.state = 'ready'; return view(); },
    run: async (id) => { const s = steps.get(id); if (s?.state === 'ready') { s.state = 'done'; landed(id); } return view(); },
  };
}
