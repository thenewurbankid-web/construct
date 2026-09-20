'use client';

import { useEffect, useState } from 'react';
import { listClones } from '../services/CloneApi';
import type { CloneJob } from '../types';

const POLL_MS = 2000;

/** Recent clone jobs, refreshed while the Processes drawer is showing them. */
export function useCloneJobs() {
  const [jobs, setJobs] = useState<CloneJob[]>([]);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const list = await listClones();
      if (!stop && list) setJobs(list);
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return jobs;
}
