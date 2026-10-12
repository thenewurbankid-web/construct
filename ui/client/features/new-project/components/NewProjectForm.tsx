'use client';

import { MoreOptions, QuestionSeries, type QuestionStepInfo } from '@/lib/QuestionSeries';
import type { NewProjectFramework, NewProjectStep } from '../types';

type Kind = { id: NewProjectFramework; label: string; sentence: string };

type NewProjectFormProps = {
  /** The questions (name, kind, create) and the kinds of project, the first recommended. */
  steps: ReadonlyArray<QuestionStepInfo>;
  kinds: ReadonlyArray<Kind>;
  step: NewProjectStep;
  name: string;
  framework: NewProjectFramework;
  /** Line only: the first feature's name and the workspace folder the project goes in. */
  firstFeature: string;
  parentDir: string;
  /** A plain problem with the name typed so far, or null. */
  nameProblem: string | null;
  featureProblem: string | null;
  parentProblem: string | null;
  /** Where the folder will be made (`<workspace>/<name>`), or null while no name is typed. */
  destination: string | null;
  /** May Next (or Create) be pressed on the question on screen? */
  canNext: boolean;
  creating: boolean;
  error: string | null;
  onName: (v: string) => void;
  onFramework: (v: NewProjectFramework) => void;
  onFirstFeature: (v: string) => void;
  onParentDir: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  onCreate: () => void;
};

const seriesProps = (p: NewProjectFormProps) => ({ name: 'New project', steps: [...p.steps], current: p.step, busy: p.creating, canNext: p.canNext, error: p.error, errorTestId: 'new-project-error', testId: 'new-project-q' });

function NameStep(p: NewProjectFormProps) {
  return (
    <QuestionSeries {...seriesProps(p)} question="What should we call it?" inputId="new-project-name" hint={p.nameProblem ?? 'Letters, digits, "-" and "_". For example my-shop.'} nextLabel="Next" nextTestId="new-project-next" nextControl={'open-project.nameNext'} onNext={p.onNext}>
      <input id="new-project-name" className="ln-q-input" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="my-shop" value={p.name} disabled={p.creating} aria-invalid={p.nameProblem ? true : undefined} onChange={(e) => p.onName(e.target.value)} data-testid="new-project-name" data-line-control="open-project.name" />
    </QuestionSeries>
  );
}

function Recommended({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="ln-chip" data-tone="fit">
      Recommended
    </span>
  );
}

function StartsWith({ framework, firstFeature }: { framework: NewProjectFramework; firstFeature: string }) {
  if (framework !== 'line') return null;
  return <span className="ln-muted">It starts with one empty part called {firstFeature.trim()}.</span>;
}

function KindChoice({ kind, p, recommended }: { kind: Kind; p: NewProjectFormProps; recommended?: boolean }) {
  return (
    <label className="ln-q-choice" data-testid={`new-project-kind-${kind.id}`}>
      <span className="ln-q-choice-top">
        <input type="radio" name="new-project-kind" value={kind.id} checked={p.framework === kind.id} disabled={p.creating} onChange={() => p.onFramework(kind.id)} data-line-control={recommended ? 'open-project.kind' : undefined} />
        {kind.label}
        <Recommended show={recommended} />
      </span>
      <small>{kind.sentence}</small>
    </label>
  );
}

function LineMore(p: NewProjectFormProps) {
  if (p.framework !== 'line') return null;
  return (
    <>
      <label className="ln-q-field">
        <span>First part of the app</span>
        <input className="ln-q-input ln-q-input--sm" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="home" value={p.firstFeature} disabled={p.creating} aria-invalid={p.featureProblem ? true : undefined} onChange={(e) => p.onFirstFeature(e.target.value)} data-testid="new-project-feature" />
        <small>{p.featureProblem ?? 'What the app does first, for example "catalog".'}</small>
      </label>
      <label className="ln-q-field">
        <span>Put it in a folder</span>
        <input className="ln-q-input ln-q-input--sm" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="(your workspace)" value={p.parentDir} disabled={p.creating} aria-invalid={p.parentProblem ? true : undefined} onChange={(e) => p.onParentDir(e.target.value)} data-testid="new-project-parent" />
        <small>{p.parentProblem ?? 'Leave empty to put it straight in your workspace.'}</small>
      </label>
    </>
  );
}

function KindStep(p: NewProjectFormProps) {
  const [recommended, ...others] = p.kinds;
  const open = p.framework !== recommended.id || p.featureProblem !== null || p.parentProblem !== null;
  const other = (k: Kind) => <KindChoice key={k.id} kind={k} p={p} />;
  const more = (
    <MoreOptions testId="new-project-more" open={open || undefined}>
      <fieldset className="ln-q-choices" aria-label="Other kinds">
        {others.map(other)}
      </fieldset>
      <LineMore {...p} />
    </MoreOptions>
  );
  return (
    <QuestionSeries {...seriesProps(p)} question="What kind of project?" nextLabel="Next" nextTestId="new-project-next" nextControl={'open-project.kindNext'} onNext={p.onNext} onBack={p.onBack} more={more}>
      <fieldset className="ln-q-choices" aria-label="Kind of project" data-testid="new-project-framework">
        <KindChoice kind={recommended} p={p} recommended />
      </fieldset>
    </QuestionSeries>
  );
}

function Destination({ destination }: { destination: string | null }) {
  if (!destination) return null;
  return (
    <details className="ln-details">
      <summary>Details</summary>
      <p data-testid="new-project-preview">
        Will be made at <code>{destination}</code>
      </p>
    </details>
  );
}

function ConfirmStep(p: NewProjectFormProps) {
  const kind = p.kinds.find((k) => k.id === p.framework)?.label ?? p.framework;
  return (
    <QuestionSeries {...seriesProps(p)} question="Ready to create it?" nextLabel={p.creating ? 'Creating…' : 'Create'} nextTestId="new-project-create" nextControl={'open-project.create'} onNext={p.onCreate} onBack={p.onBack}>
      <div className="ln-q-summary" data-testid="new-project-summary">
        <span>
          <strong>{p.name.trim()}</strong>, a {kind}.
        </span>
        <StartsWith framework={p.framework} firstFeature={p.firstFeature} />
      </div>
      <Destination destination={p.destination} />
    </QuestionSeries>
  );
}

const STEP_VIEWS = { name: NameStep, kind: KindStep, confirm: ConfirmStep } as const;

/** Presentation-only "New project" question series for the Open-a-project screen (#445, cu7): 1) the name, 2) what kind
 * (a Line project, recommended and chosen to start with; the others and a Line project's first feature and folder sit
 * under More options), 3) a last look and Create. Making the folder, setting it up and opening it is the server's job;
 * a refusal shows on the question it belongs to. */
export function NewProjectForm(p: NewProjectFormProps) {
  const Step = STEP_VIEWS[p.step];
  return (
    <section className="new-project-q" aria-label="New project" data-testid="new-project">
      <Step {...p} />
    </section>
  );
}
