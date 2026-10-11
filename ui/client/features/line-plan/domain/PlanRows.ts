// Pure (DOMAIN-001): a PlanView as the rows the Plan panel shows.
import { changeResult } from './PlanResult.ts';
import type { LineStepResult, PlanStepRow, PlanStepView, PlanView, StepChoice } from '../types.ts';

const LABELS: Record<PlanStepView['state'], string> = {
  waiting: 'Waiting for your approval',
  ready: 'Ready to run',
  running: 'Running',
  done: 'Done',
  'needs-you': 'Needs you',
  'needs-fix': 'Needs a fix',
  failed: 'Failed',
  skipped: 'Skipped',
};

const CHOICE_LABELS: Record<'retry' | 'leave', string> = { retry: 'Try again', leave: 'Leave as it is' };

/** The person's choices on a step that needs them: Construct's fixes that can run (the recommended one first, as
 * "Apply recommended fix"), then Try again and Leave as it is. */
function choicesOf(r: LineStepResult): StepChoice[] {
  const fixes = r.options.filter((o) => o.id === 'fix' && o.step).sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)));
  const fixChoices: StepChoice[] = fixes.map((o, i) => ({ key: `fix:${o.fixId ?? i}`, id: 'fix', label: o.recommended ? 'Apply recommended fix' : `Apply fix ${i + 1}`, sentence: o.sentence, step: o.step ?? undefined }));
  const rest: StepChoice[] = r.options.filter((o) => o.id === 'retry' || o.id === 'leave').map((o) => ({ key: o.id, id: o.id, label: CHOICE_LABELS[o.id as 'retry' | 'leave'], sentence: o.sentence }));
  return [...fixChoices, ...rest];
}

/** The tool call as one line for Details, without the plan-only fields (expect, retry). */
function callText(step: Pick<PlanStepView, 'tool' | 'args'>): string {
  const { expect: _e, retry: _r, fixOf: _f, ...args } = step.args ?? {};
  return `${step.tool}(${JSON.stringify(args)})`;
}

/** One step's row. */
export function stepRow(step: PlanStepView): PlanStepRow {
  const r = changeResult(step);
  const needsYou = step.state === 'needs-you' || step.state === 'needs-fix';
  const choices: StepChoice[] = needsYou && r ? choicesOf(r) : [];
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

