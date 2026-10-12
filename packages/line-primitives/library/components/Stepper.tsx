// @line-level molecule
'use client';

export type Step = { label: string };
export type StepperProps = {
  /** Names the flow. */
  label: string;
  steps: Step[];
  /** The current step, from 0. */
  current: number;
  /** A finished step was chosen (its index); without it finished steps are not buttons. */
  onStepChange?: (index: number) => void;
  orientation?: 'horizontal' | 'vertical';
};

type StepState = 'complete' | 'current' | 'upcoming';
const stateOf = (i: number, current: number): StepState => (i < current ? 'complete' : i === current ? 'current' : 'upcoming');

/** Where the user is in a multi-step flow; finished steps can be revisited. */
export function Stepper({ label, steps, current, onStepChange, orientation = 'horizontal' }: StepperProps) {
  return (
    <ol aria-label={label} data-orientation={orientation} className={orientation === 'vertical' ? 'flex flex-col gap-3' : 'flex items-center gap-3'}>
      {steps.map((s, i) => <StepItem key={s.label} step={s} index={i} state={stateOf(i, current)} onStepChange={onStepChange} />)}
    </ol>
  );
}

const DOT: Record<StepState, string> = { complete: 'bg-slate-900 text-white', current: 'border-2 border-slate-900 text-slate-900', upcoming: 'border border-slate-300 text-slate-500' };

function StepItem({ step, index, state, onStepChange }: { step: Step; index: number; state: StepState; onStepChange?: (i: number) => void }) {
  return (
    <li aria-current={state === 'current' ? 'step' : undefined} data-state={state} className="flex items-center gap-2">
      <span aria-hidden="true" data-part="indicator" className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${DOT[state]}`}>{state === 'complete' ? '✓' : index + 1}</span>
      <StepLabel step={step} index={index} state={state} onStepChange={onStepChange} />
    </li>
  );
}

function StepLabel({ step, index, state, onStepChange }: { step: Step; index: number; state: StepState; onStepChange?: (i: number) => void }) {
  const hint = state === 'complete' ? <span className="sr-only"> (completed)</span> : null;
  if (state === 'complete' && onStepChange) {
    return <button type="button" data-part="label" onClick={() => onStepChange(index)} className="rounded text-sm font-medium text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">{step.label}{hint}</button>;
  }
  return <span data-part="label" className="text-sm font-medium text-slate-900 data-[upcoming]:text-slate-500">{step.label}{hint}</span>;
}
