'use client';

import { useEffect, useState } from 'react';
import { listClones } from '../services/CloneReadApi';
import { pollCloneList } from '../services/CloneJobPolling';
import type { CloneJob } from '../types';

/** Recent clone jobs, refreshed while the Processes drawer is showing them. */
export function useCloneJobs() {
  const [jobs, setJobs] = useState<CloneJob[]>([]);
  useEffect(() => pollCloneList(listClones, setJobs), []);
  return jobs;
}
