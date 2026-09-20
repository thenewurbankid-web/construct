'use client';

import type { CloneJobView } from '../types';

/** Presentation-only list of recent clones for the Processes drawer (#330): what is being copied, how far it
 * is, and how it ended. Renders nothing when there are none, so the drawer's own empty state is unchanged. */
export function CloneJobList({ jobs }: { jobs: CloneJobView[] }) {
  if (jobs.length === 0) return null;
  return (
    <section className="clone-jobs" aria-label="Repository clones" data-testid="clone-jobs">
      <h3 className="clone-jobs__title">Clones</h3>
      <ul className="clone-jobs__list">
        {jobs.map((j) => (
          <li key={j.id} className={`clone-jobs__item clone__job--${j.tone}`} data-testid="clone-job-row">
            <div className="clone__job-head">
              <strong>{j.title}</strong>
              <span className="clone__state">{j.stateLabel}</span>
            </div>
            {j.live && (
              <div className="clone__bar" role="progressbar" aria-label={`${j.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={j.percent ?? undefined}>
                <div className="clone__bar-fill" style={{ width: `${j.percent ?? 8}%` }} />
              </div>
            )}
            <p className="hint">{j.progress}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
