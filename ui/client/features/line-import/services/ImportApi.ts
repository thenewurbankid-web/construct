import { lineHttp } from '@/lib/lineHttp';
import { isLineMock } from '@/lib/lineMode';
import { runPlanStepsNow, stepApply } from '@/lib/linePlanRun';
import type { ImportApi, ImportApplyOutcome, ImportPlan, ImportStep, LineRefusal } from '../types';
import type { ImportPlanRequest } from '@/lib/lineContract';

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

type StepView = { id: string; ok: boolean; sentence: string };

/** Run import steps one at a time (each added, approved by the person's click and run through the plan), so a refused
 * step leaves no later step waiting in the plan. Stops at the first that does not land, with `pending` for the person:
 * Undo or Leave. `before` carries the steps and files of an earlier run (Leave carries on from it). */
async function runImportSteps(steps: ImportStep[], before: { steps: StepView[]; files: string[]; landed: number }, summary: string): Promise<ImportApplyOutcome | LineRefusal> {
  const stepsView = [...before.steps];
  const files = [...before.files];
  let landed = before.landed;
  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i];
    const head = s.sentence.split(/(?<=[.?!])\s/)[0].replace(/[.?!]$/, '');
    const r = await runPlanStepsNow([{ tool: s.tool, args: s.args, why: s.sentence }]);
    if (!r.ok) {
      if (!landed) return { ok: false, sentence: r.sentence, code: r.code ?? 'REFUSED' };
      // It could not even join the plan; what landed before it can still be undone.
      return { ok: false, sentence: `Stopped at "${head}": ${lowerFirst(r.sentence)}`, files: [], findings: [], steps: stepsView, pending: { planStepId: '', rest: steps.slice(i + 1), landed } };
    }
    const ran = r.ran[0];
    const apply = stepApply(ran);
    if (r.landed) {
      stepsView.push({ id: s.id, ok: true, sentence: s.sentence });
      files.push(...(apply?.files ?? []));
      landed += 1;
      continue;
    }
    const why = apply && !apply.ok ? apply.sentence : ran?.sentence ?? 'a step did not run.';
    stepsView.push({ id: s.id, ok: false, sentence: ran?.sentence ?? why });
    return {
      ok: false, sentence: `Stopped at "${head}": ${lowerFirst(why)}`, files: [], findings: apply?.findings ?? [], steps: stepsView,
      ...(ran && landed ? { pending: { planStepId: ran.id, rest: steps.slice(i + 1), landed } } : {}),
    };
  }
  return { ok: true, sentence: `Saved. ${summary}`, files: [...new Set(files)], findings: [], steps: stepsView };
}

/** Apply (owner decision a, 11 Oct; all or nothing, iv2): the click is the person's approval. First line.import.save
 * keeps the folder as it is (Line state), then the import steps run one by one through Construct's writer, each inside
 * the chosen folder. When a later step is refused, the screen asks: Undo the import (recommended) or Leave it. */
async function applyThroughPlan(req: ImportPlanRequest, plan: ImportPlan | null): Promise<ImportApplyOutcome | LineRefusal> {
  const steps = plan?.steps ?? [];
  if (!steps.length) return { ok: false, sentence: `There is nothing in ${req.folder} for Line to bring in.`, code: 'NOTHING_TO_IMPORT' };
  const saved = await runPlanStepsNow([{ tool: 'line.import.save', args: { folder: req.folder }, why: `Save ${req.folder} as it is, so the import can be undone.` }]);
  if (!saved.ok) return { ok: false, sentence: saved.sentence, code: saved.code ?? 'REFUSED' };
  if (!saved.landed) return { ok: false, sentence: saved.ran[0]?.sentence ?? `${req.folder} could not be saved first, so nothing was imported.`, code: 'NOT_SAVED' };
  return runImportSteps(steps, { steps: [], files: [], landed: 0 }, plan?.summary ?? `Brought ${req.folder} into Line.`);
}

/** Undo: leave the refused step as it is and put the folder back (line.import.undo), both approved by this one click. */
async function undoThroughPlan(folder: string, before: ImportApplyOutcome): Promise<ImportApplyOutcome | LineRefusal> {
  const pending = before.pending;
  if (!pending) return { ok: false, sentence: 'There is nothing to undo.', code: 'NOTHING_TO_UNDO' };
  const leave = pending.planStepId ? [{ tool: 'line.leaveAsIs', args: { stepId: pending.planStepId }, why: 'Undo the import instead of fixing this step.' }] : [];
  const r = await runPlanStepsNow([...leave, { tool: 'line.import.undo', args: { folder }, why: `Put ${folder} back as it was before the import.` }]);
  if (!r.ok) return { ok: false, sentence: r.sentence, code: r.code ?? 'REFUSED' };
  const undo = r.ran.find((s) => s.tool === 'line.import.undo');
  if (!r.landed || !undo) return { ...before, sentence: `The undo did not land: ${lowerFirst(undo?.sentence ?? r.ran[r.ran.length - 1]?.sentence ?? 'it did not run.')}` };
  return { ok: false, undone: true, sentence: `Undone: ${folder} is back as it was before the import; nothing of it stayed.`, files: stepApply(undo)?.files ?? [], findings: [], steps: [] };
}

/** Leave: carry on without the refused step (line.leaveAsIs), then run the import steps that had not run yet. */
async function leaveThroughPlan(folder: string, before: ImportApplyOutcome, plan: ImportPlan | null): Promise<ImportApplyOutcome | LineRefusal> {
  const pending = before.pending;
  if (!pending) return { ok: false, sentence: 'There is nothing to leave.', code: 'NOTHING_TO_LEAVE' };
  if (pending.planStepId) {
    const r = await runPlanStepsNow([{ tool: 'line.leaveAsIs', args: { stepId: pending.planStepId }, why: 'Leave this import step as it is and carry on.' }]);
    if (!r.ok) return { ok: false, sentence: r.sentence, code: r.code ?? 'REFUSED' };
  }
  return runImportSteps(pending.rest, { steps: before.steps, files: before.files, landed: pending.landed }, plan?.summary ?? `Brought ${folder} into Line.`);
}

/** The API the Import screen talks to: the shared LINE_API mirror (lib/lineHttp.ts) on the server, with Apply through
 * the plan, or the contract's in-memory mock (packages/engine/line/mockImport.mjs) in Line mock mode (?line=mock).
 * The mock is loaded only when asked for. */
export async function loadImportApi(): Promise<ImportApi> {
  if (!isLineMock()) return { importFolders: lineHttp.importFolders, importScan: lineHttp.importScan, importPlan: lineHttp.importPlan, importApply: applyThroughPlan, importUndo: undoThroughPlan, importLeave: leaveThroughPlan };
  const { mockImportApi } = await import('./ImportApi.mock');
  return mockImportApi;
}
