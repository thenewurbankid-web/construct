import { lineHttp } from '@/lib/lineHttp';
import type { LinePagesApi } from '../types';
import { isLineMock } from '@/lib/lineMode';

/** The API the screen talks to: the shared LINE_API mirror (lib/lineContract.ts, lib/lineHttp.ts) on the server, or the contract's in-memory
 * mock when Line mock mode is on. The mock is loaded only when asked for, so it is never part of the normal screen's code. */
export async function loadLinePagesApi(): Promise<LinePagesApi> {
  if (!isLineMock()) return lineHttp;
  const { mockLinePagesApi } = await import('./LinePagesApi.mock');
  return mockLinePagesApi;
}

/** What adding a plan step answers (the Plan panel's addStep). */
type AddStep = (req: { tool: string; args: Record<string, unknown> }) => Promise<{ ok: boolean; sentence: string; code?: string; detail?: string }>;

/** cp1: the screen's writes as plan steps. Save (a prop) and Save code (a fragment) add a step to the project's plan
 * instead of writing: the answer is "Waiting for your approval: ..." (or the refusal, with its code and detail), and the
 * person's Approve in the Plan panel runs it. Line mock mode (no server, no plan) keeps writing to the mock directly. */
export function withPlan(api: LinePagesApi, addStep: AddStep): LinePagesApi {
  if (isLineMock()) return api;
  const add = async (tool: string, args: Record<string, unknown>) => {
    const r = await addStep({ tool, args });
    return r.ok ? { ok: true, sentence: r.sentence, files: [], findings: [] } : { ok: false as const, sentence: r.sentence, code: r.code ?? 'REFUSED', ...(r.detail ? { detail: r.detail } : {}) };
  };
  return { ...api, setPageProp: (req) => add('line.setPageProp', req), setFragment: (req) => add('line.setFragment', req) };
}
