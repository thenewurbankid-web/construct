// Pure (DOMAIN-001): a PlanView as the rows the Plan panel shows.
import { changeResult } from './PlanResult.ts';
import type { PlanStepRow, PlanStepView, PlanView, StepChoice } from '../types.ts';

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

/** The tool call as one line for Details, without the plan-only fields (expect, retry). */
function callText(step: Pick<PlanStepView, 'tool' | 'args'>): string {
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

