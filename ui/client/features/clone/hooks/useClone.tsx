'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { isLiveJob } from '../domain/CloneWording';
import { cancelClone, readClone, startClone } from '../services/CloneApi';
import { cloneReducer, initialCloneState } from '../workflows/Clone';

const POLL_MS = 700;

/** The clone form: start a clone, follow its job until it ends, cancel it, and hand the finished folder to
 * `onCloned` (the Open-a-project screen opens it). */
export function useClone(onCloned: (dir: string) => void) {
  const [state, dispatch] = useReducer(cloneReducer, initialCloneState);
  const handed = useRef<string | null>(null);
  const jobId = state.job?.id ?? null;
  const live = isLiveJob(state.job);

  useEffect(() => {
    if (!jobId || !live) return;
    let stop = false;
    const tick = async () => {
      const r = await readClone(jobId);
      if (stop) return;
      if (r.ok) dispatch({ type: 'JOB', job: r.job });
    };
    const t = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [jobId, live]);

  const job = state.job;
  useEffect(() => {
    if (job && job.state === 'done' && job.dir && handed.current !== job.id) {
      handed.current = job.id;
      onCloned(job.dir);
    }
  }, [job, onCloned]);

  const start = useCallback(async () => {
    dispatch({ type: 'START' });
    const r = await startClone(state.url.trim(), state.name.trim());
    dispatch(r.ok ? { type: 'STARTED', job: r.job } : { type: 'REFUSED', error: r.error });
  }, [state.url, state.name]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    const r = await cancelClone(jobId);
    if (r.ok) dispatch({ type: 'JOB', job: r.job });
  }, [jobId]);

  return {
    state,
    setUrl: (url: string) => dispatch({ type: 'SET_URL', url }),
    setName: (name: string) => dispatch({ type: 'SET_NAME', name }),
    start,
    cancel,
    dismiss: () => dispatch({ type: 'DISMISS' }),
  };
}
