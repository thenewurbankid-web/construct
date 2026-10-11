// Pure (DOMAIN-001): a PlanView as the rows the Plan panel shows, and any server answer as a PlanAnswer.
import type { LastRun, LineStepResult, PlanAnswer, PlanStepRow, PlanStepView, PlanView, StepChoice } from '../types.ts';

const LABELS: Record<PlanStepView['state'], string> = {
  waiting: 'Waiting for your approval',
  ready: 'Ready to run',
  running: 'Running',
  done: 'Done',
  'needs-you': 'Needs you',
  failed: 'Failed',
  skipped: 'Skipped',
};

const CHOICE_LABELS: Record<StepChoice['id'], string> = { retry: 'Try again', leave: 'Leave as it is' };

/** A line.* change result, or null for any other step's result. */
export function changeResult(step: PlanStepView): LineStepResult | null {
  const r = step.result as Partial<LineStepResult> | null;
  return r && typeof r === 'object' && Array.isArray(r.checks) && r.apply && typeof r.apply === 'object' ? (r as LineStepResult) : null;
}

/** The tool call as one line for Details, without the plan-only fields (expect, retry). */
export function callText(step: Pick<PlanStepView, 'tool' | 'args'>): string {
  const { expect: _e, retry: _r, ...args } = step.args ?? {};
  return `${step.tool}(${JSON.stringify(args)})`;
}

/** One step's row. */
export function stepRow(step: PlanStepView): PlanStepRow {
  const r = changeResult(step);
  const needsYou = step.state === 'needs-you';
  const choices: StepChoice[] = needsYou && r ? r.options.filter((o) => o.id !== 'fix').map((o) => ({ id: o.id as StepChoice['id'], label: CHOICE_LABELS[o.id as StepChoice['id']], sentence: o.sentence })) : [];
  return {
    id: step.id,
    n: step.n,
    state: step.state,
    stateLabel: LABELS[step.state],
    sentence: step.sentence,
    gapLines: step.gap.map((g) => g.sentence),
    failing: needsYou && r ? r.checks.filter((c) => !c.ok).map((c) => c.sentence) : [],
    fixes: needsYou && r ? r.options.filter((o) => o.id === 'fix').map((o) => o.sentence) : [],
    choices,
    canApprove: step.state === 'waiting',
    call: callText(step),
    checks: r ? r.checks.map((c) => `${c.ok ? 'Passed' : 'Failed'}: ${c.sentence}`) : [],
    files: r ? r.apply.files : [],
  };
}

/** The panel's rows: newest first, so the step just added or run is on top. */
export function planRows(view: PlanView | null): PlanStepRow[] {
  return view ? [...view.steps].reverse().map(stepRow) : [];
}

/** The step `stepId` once it ran (done or needs the person), for a screen's notice; null before it ran. */
export function lastRun(view: PlanView | null, stepId: string | null): LastRun | null {
  const ran = view && stepId ? view.steps.find((s) => s.id === stepId && (s.state === 'done' || s.state === 'needs-you')) : undefined;
  if (!ran) return null;
  const r = changeResult(ran);
  return { stepId: ran.id, tool: ran.tool, apply: r ? r.apply : null, sentence: ran.sentence };
}

/** Any server answer as a PlanAnswer: a PlanView, or the refusal's sentence. */
export function toPlanAnswer(body: unknown): PlanAnswer {
  const b = (body && typeof body === 'object' ? body : {}) as { ok?: unknown; steps?: unknown; sentence?: unknown };
  if (b.ok === true && Array.isArray(b.steps)) return { ok: true, view: body as PlanView };
  return { ok: false, sentence: typeof b.sentence === 'string' && b.sentence ? b.sentence : 'Cockpit could not read the plan; nothing was changed.' };
}
