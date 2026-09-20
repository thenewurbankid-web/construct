'use client';

import { Button, Field, Input } from '@/components/ui';
import type { CloneJobView } from '../types';

type CloneFormProps = {
  url: string;
  name: string;
  /** Hint about the URL as typed, or null. */
  urlHint: string | null;
  /** The folder name that will be used when the name field is left empty. */
  suggestedName: string;
  busy: boolean;
  error: string | null;
  job: CloneJobView | null;
  onUrl: (v: string) => void;
  onName: (v: string) => void;
  onStart: () => void;
  onCancel: () => void;
  onDismiss: () => void;
};

/** Presentation-only "Clone a repository" form for the Open-a-project screen (#330): one address field, an
 * optional folder name, the button, and the live progress of the clone with a Cancel. */
export function CloneForm({ url, name, urlHint, suggestedName, busy, error, job, onUrl, onName, onStart, onCancel, onDismiss }: CloneFormProps) {
  const working = busy || !!job?.live;
  // The hint is advice, not a gate: the server is the one that decides what may be cloned.
  const canStart = url.trim() !== '' && !working;
  return (
    <section className="clone" aria-labelledby="clone-heading" data-testid="clone">
      <h2 id="clone-heading" className="clone__heading">Clone a repository</h2>
      <p className="hint">
        Paste the address of a public repository. It is copied into the workspace as a new folder and opened, with
        <code> origin </code>set to that address. Only https addresses on allowed hosts (github.com by default) work.
      </p>
      <form
        className="clone__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canStart) onStart();
        }}
      >
        <Field label="Repository address" hint={urlHint}>
          <Input
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://github.com/owner/repository"
            value={url}
            disabled={working}
            onChange={(e) => onUrl(e.target.value)}
            data-testid="clone-url"
          />
        </Field>
        <Field label="Folder name (optional)" hint={suggestedName ? `Leave empty to use “${suggestedName}”.` : 'Leave empty to use the repository name.'}>
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
    </section>
  );
}
