'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { isLiveJob } from '../domain/CloneJobView';
import { normalizeCloneInput } from '../domain/CloneInput';
import { readClone } from '../services/CloneReadApi';
import { rememberClone } from '../services/CloneRecentStore';
import { cancelClone, startClone } from '../services/CloneStartApi';
import { pollCloneJob } from '../services/CloneJobPolling';
import { effectiveAuthMode } from '../domain/GithubConnection';
import { repoAddress } from '../domain/GithubRepoPick';
import { cloneReducer, initialCloneState } from '../workflows/Clone';
import type { CloneAuthMode, GithubStatus } from '../types';

/** The clone form: read what was pasted, start a clone, follow its job until it ends, cancel it, and hand the
 * finished folder to `onCloned` (the Open-a-project screen opens it). */
export function useClone(onCloned: (dir: string) => void, github: GithubStatus | null = null) {
  const [state, dispatch] = useReducer(cloneReducer, initialCloneState);
  const handed = useRef<string | null>(null);
  const jobId = state.job?.id ?? null;
  const live = isLiveJob(state.job);

  useEffect(() => {
    if (!jobId || !live) return;
    return pollCloneJob(jobId, readClone, (job) => dispatch({ type: 'JOB', job }));
  }, [jobId, live]);

  const job = state.job;
  useEffect(() => {
    if (job && job.state === 'done' && job.dir && handed.current !== job.id) {
      handed.current = job.id;
      rememberClone(job);
      onCloned(job.dir);
    }
  }, [job, onCloned]);

  const start = useCallback(async () => {
    const parsed = normalizeCloneInput(state.input);
    if (!parsed.ok) {
      dispatch({ type: 'REFUSED', error: parsed.problem });
      return;
    }
    dispatch({ type: 'START' });
    // #638: with a GitHub connection the login is the default; only then is no token sent (and never both).
    const useLogin = effectiveAuthMode(github, state.authChoice) === 'login';
    const r = await startClone({ url: parsed.url, name: state.name.trim(), branch: (state.branch ?? parsed.branch ?? '').trim(), token: useLogin ? '' : state.token, useLogin });
    dispatch(r.ok ? { type: 'STARTED', job: r.job } : { type: 'REFUSED', error: r.error });
  }, [state.input, state.name, state.branch, state.token, state.authChoice, github]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    const r = await cancelClone(jobId);
    if (r.ok) dispatch({ type: 'JOB', job: r.job });
  }, [jobId]);

  return {
    state,
    setInput: (input: string) => dispatch({ type: 'SET_INPUT', input }),
    setName: (name: string) => dispatch({ type: 'SET_NAME', name }),
    setBranch: (branch: string) => dispatch({ type: 'SET_BRANCH', branch }),
    setToken: (token: string) => dispatch({ type: 'SET_TOKEN', token }),
    setAuthMode: (mode: CloneAuthMode) => dispatch({ type: 'SET_AUTH', mode }),
    /** #638: picking a repository from the GitHub picker fills the address; an empty pick changes nothing. */
    pickRepo: (fullName: string) => {
      if (fullName) dispatch({ type: 'SET_INPUT', input: repoAddress(fullName) });
    },
    start,
    cancel,
    dismiss: () => dispatch({ type: 'DISMISS' }),
  };
}
