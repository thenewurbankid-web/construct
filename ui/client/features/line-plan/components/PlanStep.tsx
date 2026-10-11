import type { PlanStepRow, StepChoice } from '../types';

type Decide = { busy: boolean; onApprove: (stepId: string) => void; onChoose: (stepId: string, choice: StepChoice) => void };

const line = (text: string) => <li key={text}>{text}</li>;

/** cg1: the control id Trace lights for a choice (one control registry, packages/engine/line/controls.mjs). */
const CHOICE_CONTROL: Record<StepChoice['id'], string> = { retry: 'plan.retry', leave: 'plan.leave', fix: 'plan.fix' };
const choiceControl = (c: StepChoice) => CHOICE_CONTROL[c.id];
const code = (text: string) => <code key={text}>{text}</code>;

/** Plain-English lines under a step (what is already there, which checks failed, what a finding suggests). */
function Lines({ label, lines, testId }: { label: string; lines: string[]; testId: string }) {
  if (!lines.length) return null;
  return (
    <ul className="lpl-lines" aria-label={label} data-testid={testId}>
      {lines.map(line)}
    </ul>
  );
}

/** Approve for a step waiting on the person; Try again / Leave as it is for a step that needs them. */
function Actions({ row, busy, onApprove, onChoose }: Decide & { row: PlanStepRow }) {
  const choice = (c: StepChoice) => (
    <button key={c.key} type="button" className={c.label === 'Apply recommended fix' ? 'lpl-btn lpl-btn--primary' : 'lpl-btn'} title={c.sentence} data-line-control={choiceControl(c)} data-line-target={String(row.n)} onClick={() => onChoose(row.id, c)} disabled={busy}>
      {c.label}
    </button>
  );
  if (!row.canApprove && !row.choices.length) return null;
  if (!row.canApprove) return <span className="lpl-actions">{row.choices.map(choice)}</span>;
  return (
    <span className="lpl-actions">
      <button type="button" className="lpl-btn lpl-btn--primary" aria-label={`Approve step ${row.n}`} data-line-control="plan.approve" data-line-target={String(row.n)} onClick={() => onApprove(row.id)} disabled={busy}>
        Approve
      </button>
    </span>
  );
}

/** One plan step: its state and sentence first; what is already there before it runs; the failing checks and the
 * person's choices when it needs them; the tool call, each check and the files written under a collapsed Details. */
export function PlanStep({ row, ...decide }: Decide & { row: PlanStepRow }) {
  return (
    <li className="lpl-step" data-testid="plan-step" data-state={row.state}>
      <span className="lpl-state" data-state={row.state}>
        {row.stateLabel}
      </span>
      <p className="lpl-sentence" data-testid="plan-step-sentence">
        {row.sentence}
      </p>
      <Lines label={`Before step ${row.n} runs`} lines={row.gapLines} testId="plan-step-gap" />
      <Lines label={`Checks that failed in step ${row.n}`} lines={row.failing} testId="plan-step-failing" />
      <Lines label={`What the findings suggest for step ${row.n}`} lines={row.fixes} testId="plan-step-fixes" />
      <Actions row={row} {...decide} />
      <details className="lpl-tech">
        <summary>Details</summary>
        <code data-testid="plan-step-call">{row.call}</code>
        {row.checks.map(code)}
        {row.files.map(code)}
      </details>
    </li>
  );
}
