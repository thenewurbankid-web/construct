'use client';

import type { ReactNode } from 'react';
import { Button, Field, Input } from '@/components/ui';
import type { CloneJobView } from '../types';

/** What the pasted text was read as: the address that will be cloned, the folder and the branch. */
export type ClonePreview = { url: string; folder: string; branch: string | null; how: string; note: string | null };

type CloneFormProps = {
  input: string;
  name: string;
  /** The branch as it will be used: typed by the person, else read from the address, else ''. */
  branch: string;
  token: string;
  /** A plain problem with the pasted text, or null. */
  inputProblem: string | null;
  /** The derived address, folder and branch, once the text is understood. */
  preview: ClonePreview | null;
  workspaceRoot: string | null;
  folderProblem: string | null;
  branchProblem: string | null;
  tokenProblem: string | null;
  busy: boolean;
  error: string | null;
  job: CloneJobView | null;
  /** The recent-clones list (another component of this feature, composed by the controller). */
  recent?: ReactNode;
  onInput: (v: string) => void;
  onName: (v: string) => void;
  onBranch: (v: string) => void;
  onToken: (v: string) => void;
  onStart: () => void;
  onCancel: () => void;
  onDismiss: () => void;
};

const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new';

/** Presentation-only "Clone a repository" form for the Open-a-project screen (#330): ONE field that takes whatever
 * people paste, the address it was understood as, an optional folder name and branch, an optional one-time access
 * token for a private repository, the button, and the live progress of the clone with a Cancel. */
export function CloneForm({
  input, name, branch, token, inputProblem, preview, workspaceRoot, folderProblem, branchProblem, tokenProblem, busy, error, job, recent,
  onInput, onName, onBranch, onToken, onStart, onCancel, onDismiss,
}: CloneFormProps) {
  const working = busy || !!job?.live;
  // The hints are advice, not a gate: the server is the one that decides what may be cloned.
  const canStart = input.trim() !== '' && !inputProblem && !folderProblem && !branchProblem && !tokenProblem && !working;
  return (
    <section className="clone" aria-labelledby="clone-heading" data-testid="clone">
      <h2 id="clone-heading" className="clone__heading">Clone a repository</h2>
      <p className="hint">
        Paste a repository the way you have it: <code>owner/repo</code>, a link copied from the browser, or a whole <code>git clone</code> line.
        It is copied into the workspace as a new folder and opened. No terminal needed.
      </p>
      <form
        className="clone__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canStart) onStart();
        }}
      >
        <Field label="Repository" hint={inputProblem}>
          <Input
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="owner/repo, a link, or git clone …"
            value={input}
            disabled={working}
            aria-invalid={inputProblem ? true : undefined}
            onChange={(e) => onInput(e.target.value)}
            data-testid="clone-url"
          />
        </Field>
        {preview && (
          <div className="clone__preview" role="status" aria-live="polite" data-testid="clone-preview">
            <div>
              Will clone <code data-testid="clone-preview-url">{preview.url}</code>
            </div>
            <div>
              into <code data-testid="clone-preview-dest">{workspaceRoot ? `${workspaceRoot.replace(/[\\/]+$/, '')}/${name.trim() || preview.folder}` : name.trim() || preview.folder}</code>
              {branch ? (
                <>
                  {' '}on branch <code data-testid="clone-preview-branch">{branch}</code>
                </>
              ) : null}
            </div>
            <div className="hint">{[preview.how, preview.note].filter(Boolean).join(' ')}</div>
          </div>
        )}
        <div className="clone__row">
          <Field label="Folder name (optional)" hint={folderProblem ?? (preview ? `Leave empty to use “${preview.folder}”.` : 'Leave empty to use the repository name.')}>
            <Input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={name}
              disabled={working}
              onChange={(e) => onName(e.target.value)}
              data-testid="clone-name"
            />
          </Field>
          <Field label="Branch (optional)" hint={branchProblem ?? 'Empty means the default branch.'}>
            <Input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={branch}
              disabled={working}
              onChange={(e) => onBranch(e.target.value)}
              data-testid="clone-branch"
            />
          </Field>
        </div>
        <Field label="Access token (only for private repos)" hint={tokenProblem ?? 'Used once for this clone and never saved.'}>
          <Input
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={token}
            disabled={working}
            aria-invalid={tokenProblem ? true : undefined}
            onChange={(e) => onToken(e.target.value)}
            data-testid="clone-token"
          />
        </Field>
        <details className="clone__howto" data-testid="clone-token-help">
          <summary>How do I get a token?</summary>
          <ol>
            <li>
              Open <a href={TOKEN_PAGE} target="_blank" rel="noopener noreferrer">GitHub&apos;s new fine-grained token page</a>.
            </li>
            <li>Under &ldquo;Repository access&rdquo; choose &ldquo;Only select repositories&rdquo; and pick just this one.</li>
            <li>Under &ldquo;Repository permissions&rdquo; set &ldquo;Contents&rdquo; to &ldquo;Read-only&rdquo;. Nothing else is needed.</li>
            <li>Give it a short expiry, create it, and paste it above. It can read that one repository and cannot change anything.</li>
          </ol>
        </details>
        <div className="clone__actions">
          <Button type="submit" disabled={!canStart} data-testid="clone-start">
            {busy ? 'Starting…' : 'Clone and open'}
          </Button>
        </div>
      </form>
      {error && (
        <p className="status-error" role="alert" data-testid="clone-error">
          {error}
        </p>
      )}
      {job && (
        <div className={`clone__job clone__job--${job.tone}`} role="status" aria-live="polite" data-testid="clone-job">
          <div className="clone__job-head">
            <strong>{job.title}</strong>
            <span className="clone__state" data-testid="clone-state">{job.stateLabel}</span>
          </div>
          {job.live && (
            <div
              className="clone__bar"
              role="progressbar"
              aria-label={`${job.title} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.percent ?? undefined}
            >
              <div className="clone__bar-fill" style={{ width: `${job.percent ?? 8}%` }} />
            </div>
          )}
          <p className="hint clone__progress" data-testid="clone-progress">
            {job.progress} {job.live && <span>· {job.size}</span>}
          </p>
          <div className="clone__actions">
            {job.live && (
              <Button type="button" onClick={onCancel} disabled={job.stateLabel === 'Cancelling'} data-testid="clone-cancel">
                Cancel
              </Button>
            )}
            {!job.live && job.tone !== 'done' && (
              <Button type="button" onClick={onDismiss} data-testid="clone-dismiss">
                Dismiss
              </Button>
            )}
          </div>
        </div>
      )}
      {recent}
    </section>
  );
}
