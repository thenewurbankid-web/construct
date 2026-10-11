import { lineHttp } from './lineHttp';
import type { ApplyResult, LineHttp, LineRefusal, LineStepResult, PlanStepRequest, PlanStepView, PlanView } from './lineContract';

// Shared by every Line screen whose button IS the person's approval (owner decision a, 11 Oct): "Apply recommended
// fix" (line-fix) and Import's "Apply" (line-import). The click adds the step(s) to the project's plan, approves them
// in one go and runs them one by one, so the write still goes only through the plan (and shows in the Plan panel as
// done). Any open Plan panel hears about it (onLinePlanChanged) and reads the plan again.

const EVENT = 'line-plan-changed';

/** Tell every open Plan panel the plan changed outside it. */
export function notifyLinePlanChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

/** Call `listener` whenever a screen ran plan steps itself; returns the unsubscribe. */
export function onLinePlanChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** What running steps now answers: refused before anything joined the plan, or the steps that ran (in order; it stops
 * at the first one that did not land) and the plan as it is afterwards. */
export type RunNowAnswer =
  | { ok: false; sentence: string; code?: string; detail?: string }
  | { ok: true; ran: PlanStepView[]; view: PlanView; landed: boolean };

const isView = (b: PlanView | LineRefusal): b is PlanView => !!b && (b as PlanView).ok === true && Array.isArray((b as PlanView).steps);
const refusal = (b: unknown, fallback: string) => {
  const r = (b && typeof b === 'object' ? b : {}) as Partial<LineRefusal> & { detail?: string };
  return { ok: false as const, sentence: typeof r.sentence === 'string' && r.sentence ? r.sentence : fallback, ...(r.code ? { code: r.code } : {}), ...(r.detail ? { detail: r.detail } : {}) };
};

/** Add `steps` to the plan, approve them all with this one click, run them one by one. Never rejects.
 * `leaveIfRefused`: a step that did not land is left as it is (a line.leaveAsIs step, covered by the same click) so it
 * does not hold the plan for a screen with no Plan panel (a fix clicked on Diagnostics); its sentence still shows. */
export async function runPlanStepsNow(
  steps: PlanStepRequest[],
  { leaveIfRefused = false, http = lineHttp }: { leaveIfRefused?: boolean; http?: Pick<LineHttp, 'addPlanStep' | 'approvePlanStep' | 'runPlan'> } = {},
): Promise<RunNowAnswer> {
  try {
    const ids: string[] = [];
    for (const req of steps) {
      const added = await http.addPlanStep(req);
      if (!isView(added) || !added.stepId) return refusal(added, 'The step could not be added to the plan; nothing was changed.');
      ids.push(added.stepId);
    }
    if (!ids.length) return { ok: false, sentence: 'There is nothing to run.' };
    const approved = await http.approvePlanStep(ids.length === 1 ? ids[0] : ids);
    if (!isView(approved)) return refusal(approved, 'The steps could not be approved; nothing was changed.');
    let view = approved;
    const ran: PlanStepView[] = [];
    for (const id of ids) {
      const r = await http.runPlan(id);
      if (!isView(r)) {
        notifyLinePlanChanged();
        return ran.length ? { ok: true, ran, view, landed: false } : refusal(r, 'The step could not run; nothing was changed.');
      }
      view = r;
      const step = r.steps.find((s) => s.id === id);
      if (step) ran.push(step);
      if (!step || step.state !== 'done') {
        if (step && leaveIfRefused && (step.state === 'needs-fix' || step.state === 'needs-you')) view = await leaveAsIs(http, step.id, view);
        break;
      }
    }
    notifyLinePlanChanged();
    return { ok: true, ran, view, landed: ran.length === ids.length && ran.every((s) => s.state === 'done') };
  } catch {
    return { ok: false, sentence: 'The Cockpit server did not answer; nothing was changed.' };
  }
}

/** Record "leave it as it is" for a step that did not land (one more plan step, approved by the same click). */
async function leaveAsIs(http: Pick<LineHttp, 'addPlanStep' | 'approvePlanStep' | 'runPlan'>, stepId: string, view: PlanView): Promise<PlanView> {
  const added = await http.addPlanStep({ tool: 'line.leaveAsIs', args: { stepId } });
  if (!isView(added) || !added.stepId) return view;
  const approved = await http.approvePlanStep(added.stepId);
  if (!isView(approved)) return view;
  const r = await http.runPlan(added.stepId);
  return isView(r) ? r : view;
}

/** The ApplyResult a line.* step recorded (its `result.apply`), or null for a step that has none. */
export function stepApply(step: PlanStepView | undefined): ApplyResult | null {
  const r = step?.result as LineStepResult | null | undefined;
  return r && typeof r === 'object' && r.apply && typeof r.apply.ok === 'boolean' ? r.apply : null;
}
