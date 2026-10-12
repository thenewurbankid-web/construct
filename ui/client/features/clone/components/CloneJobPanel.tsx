'use client';

import { Button } from '@/components/ui';
import type { CloneJobView } from '../types';

function ProgressBar({ job }: { job: CloneJobView }) {
  if (!job.live) return null;
  return (
    <div className="clone__bar" role="progressbar" aria-label={`${job.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.percent ?? undefined}>
      <div className="clone__bar-fill" style={{ width: `${job.percent ?? 8}%` }} />
    </div>
  );
}

function Size({ job }: { job: CloneJobView }) {
  if (!job.live) return null;
  return <span>· {job.size}</span>;
}

function JobActions({ job, onCancel, onDismiss }: { job: CloneJobView; onCancel: () => void; onDismiss: () => void }) {
  if (job.live) {
    return (
      <Button type="button" onClick={onCancel} disabled={job.stateLabel === 'Cancelling'} data-testid="clone-cancel">
        Cancel
      </Button>
    );
  }
  if (job.tone === 'done') return null;
  return (
    <Button type="button" onClick={onDismiss} data-testid="clone-dismiss">
      Dismiss
    </Button>
  );
}

/** Presentation-only: the copy in progress (or how it ended), with Cancel while it runs and Dismiss after a failure. */
export function CloneJobPanel({ job, onCancel, onDismiss }: { job: CloneJobView | null; onCancel: () => void; onDismiss: () => void }) {
  if (!job) return null;
  return (
    <div className={`clone__job clone__job--${job.tone}`} role="status" aria-live="polite" data-testid="clone-job">
      <div className="clone__job-head">
        <strong>{job.title}</strong>
        <span className="clone__state" data-testid="clone-state">{job.stateLabel}</span>
      </div>
      <ProgressBar job={job} />
      <p className="hint clone__progress" data-testid="clone-progress">
        {job.progress} <Size job={job} />
      </p>
      <div className="clone__actions">
        <JobActions job={job} onCancel={onCancel} onDismiss={onDismiss} />
      </div>
    </div>
  );
}
