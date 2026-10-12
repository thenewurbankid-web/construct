'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import './line-style.css';

// The Open-a-project screen's question series (New project, From GitHub): one question at a time, a big input, Next
// (or Enter) to continue, Back, and a step indicator. Presentation only: the feature owns the steps and the answers.

export type QuestionStepInfo = { id: string; label: string };

export type QuestionSeriesProps = {
  /** Names the series for screen readers, e.g. "New project". */
  name: string;
  steps: QuestionStepInfo[];
  current: string;
  /** The question, in plain words ("What should we call it?"). */
  question: string;
  /** id of the input the question labels (so the heading is its label); omitted when the step has no single input. */
  inputId?: string;
  hint?: string | null;
  /** A refusal or a problem with this question's answer, in one sentence. */
  error?: string | null;
  errorTestId?: string;
  children?: ReactNode;
  /** Shown under the answer: More options, Details. */
  more?: ReactNode;
  nextLabel: string;
  nextTestId: string;
  /** cg1: the Trace control id the Next/Create button carries. */
  nextControl?: string;
  canNext: boolean;
  busy?: boolean;
  onNext: () => void;
  onBack?: () => void;
  testId: string;
};

function StepDots({ steps, current }: { steps: QuestionStepInfo[]; current: string }) {
  const at = steps.findIndex((s) => s.id === current);
  return (
    <ol className="ln-q-steps" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s.id} className="ln-q-step" data-state={i < at ? 'done' : i === at ? 'current' : 'todo'} aria-current={i === at ? 'step' : undefined}>
          <span className="ln-q-dot" aria-hidden="true" />
          <span className="ln-q-step-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function QuestionSeries(p: QuestionSeriesProps) {
  const at = p.steps.findIndex((s) => s.id === p.current);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (p.canNext && !p.busy) p.onNext();
  };
  return (
    <form className="ln-q" aria-label={p.name} onSubmit={submit} data-testid={p.testId} data-step={p.current} noValidate>
      <p className="ln-q-count" data-testid={`${p.testId}-count`}>
        Step {at + 1} of {p.steps.length}
      </p>
      <StepDots steps={p.steps} current={p.current} />
      {p.inputId ? (
        <label className="ln-q-question" htmlFor={p.inputId} data-testid={`${p.testId}-question`}>
          {p.question}
        </label>
      ) : (
        <h2 className="ln-q-question" data-testid={`${p.testId}-question`}>
          {p.question}
        </h2>
      )}
      {p.hint ? <p className="ln-muted ln-q-hint">{p.hint}</p> : null}
      {p.children}
      {p.error ? (
        <p className="ln-q-error" role="alert" data-testid={p.errorTestId}>
          {p.error}
        </p>
      ) : null}
      {p.more}
      <div className="ln-q-actions">
        {p.onBack ? (
          <button type="button" className="ln-btn ln-btn--ghost" onClick={p.onBack} disabled={p.busy} data-testid={`${p.testId}-back`}>
            Back
          </button>
        ) : null}
        <button type="submit" className="ln-btn ln-btn--primary ln-q-next" disabled={!p.canNext || p.busy} data-testid={p.nextTestId} data-line-control={p.nextControl}>
          {p.nextLabel}
        </button>
      </div>
    </form>
  );
}

/** The collapsed "More options" disclosure under a question (the .pal-group idiom, in Line style). `open` opens it (a
 * problem inside it, or a choice that lives there); it then stays as the person leaves it. */
export function MoreOptions({ children, testId, open }: { children: ReactNode; testId: string; open?: boolean }) {
  const [shown, setShown] = useState(Boolean(open));
  useEffect(() => {
    if (open) setShown(true);
  }, [open]);
  return (
    <details className="ln-more" data-testid={testId} open={shown} onToggle={(e) => setShown(e.currentTarget.open)}>
      <summary>More options</summary>
      <div className="ln-more-body">{children}</div>
    </details>
  );
}
