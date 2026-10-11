// Pure (DOMAIN-001): any server answer as a PlanAnswer.
import type { PlanAnswer, PlanView } from '../types.ts';

/** Any server answer as a PlanAnswer: a PlanView, or the refusal's sentence. */
export function toPlanAnswer(body: unknown): PlanAnswer {
  const b = (body && typeof body === 'object' ? body : {}) as { ok?: unknown; steps?: unknown; sentence?: unknown; code?: unknown; detail?: unknown };
  if (b.ok === true && Array.isArray(b.steps)) return { ok: true, view: body as PlanView };
  const sentence = typeof b.sentence === 'string' && b.sentence ? b.sentence : 'Cockpit could not read the plan; nothing was changed.';
  return { ok: false, sentence, ...(typeof b.code === 'string' ? { code: b.code } : {}), ...(typeof b.detail === 'string' && b.detail ? { detail: b.detail } : {}) };
}
