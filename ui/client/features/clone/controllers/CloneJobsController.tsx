'use client';

import { buildJobView } from '../domain/CloneJobView';
import { useCloneJobs } from '../hooks/useCloneJobs';
import { CloneJobsPage } from '../pages/ClonePage';

/** Recent clones, for the Processes drawer (composed as a slot by the processes feature). */
export function CloneJobsController() {
  const jobs = useCloneJobs();
  return <CloneJobsPage jobs={jobs.map(buildJobView)} />;
}
