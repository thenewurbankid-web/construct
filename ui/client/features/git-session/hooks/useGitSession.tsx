'use client';

import { useCallback, useEffect, useReducer, type Dispatch } from 'react';
import { fetchGitSession, saveCommitConfig } from '../services/GitSessionApi';
import { answerDirtyTree, commitNow } from '../services/GitSessionActions';
import { gitSessionReducer, initialGitSessionState, type GitSessionAction } from '../workflows/GitSession';
import type { CommitConfig, DirtyAnswer } from '../types';

/** How often the Cockpit re-reads the session. The coalescing window closes on the SERVER's timer,
 * so without a poll the indicator would go stale at exactly the moment a commit happens. */
export const POLL_MS = 1500;

// Top-level (not closures) so the hook itself stays short and each step is independently readable.
function load(dispatch: Dispatch<GitSessionAction>) {
  return fetchGitSession()
    .then((status) => dispatch({ type: 'LOADED', status }))
    .catch(() => dispatch({ type: 'LOAD_FAILED', message: 'Could not read the git session from the backend.' }));
}

async function act(dispatch: Dispatch<GitSessionAction>, run: () => Promise<{ error?: string } | null>) {
  dispatch({ type: 'BUSY' });
  const result = await run().catch((e: Error) => ({ error: e.message }));
  dispatch({ type: 'DONE', message: result?.error || null });
  await load(dispatch);
}

/**
 * The commit-on-save session: current config, the branch, what is pending, and the one question
 * this feature may ask (a dirty tree at session start). Polls rather than being told, because
 * commits also happen on a timer, with no request in flight to attach a response to.
 */
export function useGitSession() {
  const [state, dispatch] = useReducer(gitSessionReducer, initialGitSessionState);

  const refresh = useCallback(() => load(dispatch), []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const updateConfig = useCallback((patch: Partial<CommitConfig>) => act(dispatch, () => saveCommitConfig(patch)), []);
  const answer = useCallback((choice: DirtyAnswer, remember: boolean) => act(dispatch, () => answerDirtyTree(choice, remember)), []);
  const commit = useCallback(() => act(dispatch, () => commitNow()), []);

  return { status: state.status, error: state.error, busy: state.busy, refresh, updateConfig, answer, commit };
}
