import { lineHttp } from '@/lib/lineHttp';
import { isLineMock } from '@/lib/lineMode';
import { runPlanStepsNow, stepApply } from '@/lib/linePlanRun';
import type { ImportApi, ImportApplyResult, ImportStep, LineRefusal } from '../types';
import type { ImportPlanRequest } from '@/lib/lineContract';

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Apply (owner decision a, 11 Oct): the import plan's steps join the project's plan (the line.import.* tools), the
 * person's click approves them all at once, and they run one by one through Construct's writer, each inside the chosen
 * folder; it stops at the first step that does not land (those before it stay landed). */
async function applyThroughPlan(req: ImportPlanRequest, steps: ImportStep[]): Promise<ImportApplyResult | LineRefusal> {
  if (!steps.length) return { ok: false, sentence: `There is nothing in ${req.folder} for Line to bring in.`, code: 'NOTHING_TO_IMPORT' };
  const r = await runPlanStepsNow(steps.map((s) => ({ tool: s.tool, args: s.args, why: s.sentence })));
  if (!r.ok) return { ok: false, sentence: r.sentence, code: r.code ?? 'REFUSED' };
  const results = r.ran.map((step, i) => ({ step, apply: stepApply(step), id: steps[i].id, sentence: steps[i].sentence }));
  const files = [...new Set(results.flatMap((x) => x.apply?.files ?? []))];
  const stepsView = results.map((x) => ({ id: x.id, ok: x.step.state === 'done', sentence: x.step.state === 'done' ? x.sentence : x.step.sentence }));
  if (r.landed) return { ok: true, sentence: `Saved. Brought ${req.folder} into Line in ${steps.length} plan steps; nothing outside ${req.folder} changed.`, files, findings: [], steps: stepsView };
  const last = results[results.length - 1];
  const why = last?.apply && !last.apply.ok ? last.apply.sentence : last?.step.sentence ?? 'a step did not run.';
  return { ok: false, sentence: `Stopped at "${(last?.sentence ?? 'a step').replace(/[.?!]$/, '')}": ${lowerFirst(why)}`, files: [], findings: last?.apply?.findings ?? [], steps: stepsView };
}

/** The API the Import screen talks to: the shared LINE_API mirror (lib/lineHttp.ts) on the server, with Apply through
 * the plan, or the contract's in-memory mock (packages/engine/line/mockImport.mjs) in Line mock mode (?line=mock).
 * The mock is loaded only when asked for. */
export async function loadImportApi(): Promise<ImportApi> {
  if (!isLineMock()) return { importFolders: lineHttp.importFolders, importScan: lineHttp.importScan, importPlan: lineHttp.importPlan, importApply: applyThroughPlan };
  const { mockImportApi } = await import('./ImportApi.mock');
  return mockImportApi;
}
