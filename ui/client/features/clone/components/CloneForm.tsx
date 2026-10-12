'use client';

import type { ReactNode } from 'react';
import { MoreOptions, QuestionSeries, type QuestionStepInfo } from '@/lib/QuestionSeries';
import type { ClonePreview, CloneJobView, CloneStep } from '../types';
import { CloneAuthSection, type CloneAuthSectionProps } from './CloneAuthSection';
import { CloneJobPanel } from './CloneJobPanel';

type CloneFormProps = {
  /** The questions (link, private, bring it in). */
  steps: ReadonlyArray<QuestionStepInfo>;
  step: CloneStep;
  /** The answer to "Is it private?" (null: not answered yet). */
  isPrivate: boolean | null;
  input: string;
  name: string;
  /** The branch as it will be used: typed by the person, else read from the address, else ''. */
  branch: string;
  /** A plain problem with the pasted text, or null. */
  inputProblem: string | null;
  /** The derived address, folder and branch, once the text is understood. */
  preview: ClonePreview | null;
  /** The folder it will be copied into, and what the summary calls the project. */
  destination: string;
  folder: string;
  projectLabel: string;
  folderProblem: string | null;
  branchProblem: string | null;
  /** How a private project is authorised: the GitHub login (#638) or the one-time token field. */
  auth: Omit<CloneAuthSectionProps, 'disabled'>;
  /** May Next (or "Bring it in") be pressed on the question on screen? A copy is running: nothing can be changed. */
  canNext: boolean;
  working: boolean;
  busy: boolean;
  error: string | null;
  job: CloneJobView | null;
  /** The recent list (another component of this feature, composed by the controller). */
  recent?: ReactNode;
  onInput: (v: string) => void;
  onName: (v: string) => void;
  onBranch: (v: string) => void;
  onPrivate: (v: boolean) => void;
  onNext: () => void;
  onBack: () => void;
  onStart: () => void;
  onCancel: () => void;
  onDismiss: () => void;
};

const seriesProps = (p: CloneFormProps) => ({ name: 'From GitHub', steps: [...p.steps], current: p.step, busy: p.working, canNext: p.canNext, error: p.error, errorTestId: 'clone-error', testId: 'clone-q' });

function BranchPart({ branch }: { branch: string }) {
  if (!branch) return null;
  return (
    <>
      {' '}on branch <code data-testid="clone-preview-branch">{branch}</code>
    </>
  );
}

function PreviewDetails({ preview, destination, branch }: Pick<CloneFormProps, 'preview' | 'destination' | 'branch'>) {
  if (!preview) return null;
  return (
    <details className="ln-details" data-testid="clone-preview">
      <summary>Details</summary>
      <p>
        Will copy <code data-testid="clone-preview-url">{preview.url}</code>
      </p>
      <p>
        into <code data-testid="clone-preview-dest">{destination}</code>
        <BranchPart branch={branch} />
      </p>
      <p>{[preview.how, preview.note].filter(Boolean).join(' ')}</p>
    </details>
  );
}

function LinkStep(p: CloneFormProps) {
  return (
    <QuestionSeries {...seriesProps(p)} question="Paste the GitHub link" inputId="clone-url" hint={p.inputProblem ?? 'For example owner/project, or a link copied from your browser.'} nextLabel="Next" nextTestId="clone-next" nextControl={'open-project.linkNext'} onNext={p.onNext} more={<PreviewDetails preview={p.preview} destination={p.destination} branch={p.branch} />}>
      <input id="clone-url" className="ln-q-input" type="text" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="owner/project" value={p.input} disabled={p.working} aria-invalid={p.inputProblem ? true : undefined} onChange={(e) => p.onInput(e.target.value)} data-testid="clone-url" data-line-control="open-project.link" />
    </QuestionSeries>
  );
}

function PrivateChoice({ value, label, testId, p }: { value: boolean; label: string; testId: string; p: CloneFormProps }) {
  return (
    <label className="ln-q-choice" data-testid={testId}>
      <span className="ln-q-choice-top">
        <input type="radio" name="clone-private" checked={p.isPrivate === value} disabled={p.working} onChange={() => p.onPrivate(value)} />
        {label}
      </span>
    </label>
  );
}

function PrivateStep(p: CloneFormProps) {
  return (
    <QuestionSeries {...seriesProps(p)} question="Is it private?" hint="Only you, or people you invited, can see a private project." nextLabel="Next" nextTestId="clone-next" nextControl={'open-project.privateNext'} onNext={p.onNext} onBack={p.onBack}>
      <fieldset className="ln-q-choices" aria-label="Is it private?" data-testid="clone-private" data-line-control="open-project.private">
        <PrivateChoice value={false} label="No, anyone can see it" testId="clone-private-no" p={p} />
        <PrivateChoice value={true} label="Yes, it is private" testId="clone-private-yes" p={p} />
      </fieldset>
      {p.isPrivate ? <CloneAuthSection {...p.auth} disabled={p.working} /> : null}
    </QuestionSeries>
  );
}

function ConfirmMore(p: CloneFormProps) {
  return (
    <>
      <MoreOptions testId="clone-more" open={p.folderProblem !== null || p.branchProblem !== null || undefined}>
        <label className="ln-q-field">
          <span>Folder name</span>
          <input className="ln-q-input ln-q-input--sm" type="text" autoComplete="off" spellCheck={false} value={p.name} placeholder={p.preview?.folder ?? ''} disabled={p.working} aria-invalid={p.folderProblem ? true : undefined} onChange={(e) => p.onName(e.target.value)} data-testid="clone-name" />
          <small>{p.folderProblem ?? 'Leave empty to use the project’s own name.'}</small>
        </label>
        <label className="ln-q-field">
          <span>Branch</span>
          <input className="ln-q-input ln-q-input--sm" type="text" autoComplete="off" spellCheck={false} value={p.branch} disabled={p.working} aria-invalid={p.branchProblem ? true : undefined} onChange={(e) => p.onBranch(e.target.value)} data-testid="clone-branch" />
          <small>{p.branchProblem ?? 'Leave empty for the main one.'}</small>
        </label>
      </MoreOptions>
      <PreviewDetails preview={p.preview} destination={p.destination} branch={p.branch} />
    </>
  );
}

function ConfirmStep(p: CloneFormProps) {
  return (
    <QuestionSeries {...seriesProps(p)} question="Ready to bring it in?" nextLabel={p.busy ? 'Starting…' : 'Bring it in'} nextTestId="clone-start" nextControl={'open-project.bringIn'} onNext={p.onStart} onBack={p.onBack} more={<ConfirmMore {...p} />}>
      <div className="ln-q-summary" data-testid="clone-summary">
        <span>
          <strong>{p.projectLabel}</strong> will be copied into your workspace as <strong>{p.folder}</strong> and opened.
        </span>
      </div>
      <CloneJobPanel job={p.job} onCancel={p.onCancel} onDismiss={p.onDismiss} />
    </QuestionSeries>
  );
}

const STEP_VIEWS = { link: LinkStep, private: PrivateStep, confirm: ConfirmStep } as const;

/** Presentation-only "From GitHub" question series for the Open-a-project screen (#330, #638): 1) the link, pasted the
 * way people have it (owner/repo, a browser link or a whole copy line), 2) is it private (yes asks for the GitHub
 * login or a one-time access token, with how to get one), 3) a last look, the folder name and branch under More
 * options, and "Bring it in", with the live progress and Cancel. A refusal shows on the question it belongs to. */
export function CloneForm(p: CloneFormProps) {
  const Step = STEP_VIEWS[p.step];
  return (
    <section className="clone-q" aria-label="From GitHub" data-testid="clone">
      <Step {...p} />
      {p.recent}
    </section>
  );
}
