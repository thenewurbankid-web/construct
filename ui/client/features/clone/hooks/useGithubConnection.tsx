'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { disconnectGithub, readGithubRepos, readGithubStatus } from '../services/GithubApi';
import { startGithubConnect } from '../services/GithubConnect';
import { githubReducer, initialGithubState } from '../workflows/Github';

const FILTER_DEBOUNCE_MS = 250;

/** The GitHub connection for private repositories (#638): whether it is on and made (and for which account), the
 * repositories it can read (only when `withRepos`, for the clone form's picker), Connect and Disconnect. The token is
 * never here: it lives in the server's memory and is never sent to the browser. */
export function useGithubConnection({ withRepos = false }: { withRepos?: boolean } = {}) {
  const [state, dispatch] = useReducer(githubReducer, initialGithubState);
  const [reloads, setReloads] = useState(0);
  const connected = state.status?.connected === true;
  const query = state.query;

  useEffect(() => {
    let stop = false;
    readGithubStatus().then((r) => {
      if (!stop) dispatch(r.ok ? { type: 'STATUS', status: r.status } : { type: 'STATUS_FAILED' });
    });
    return () => {
      stop = true;
    };
  }, []);

  // The first page of repositories, again when the filter changes (a moment after typing stops) or a reload is asked for.
  useEffect(() => {
    if (!withRepos || !connected) return;
    let stop = false;
    const timer = setTimeout(async () => {
      dispatch({ type: 'REPOS_LOADING' });
      const r = await readGithubRepos({ page: 1, q: query });
      if (stop) return;
      if (r.ok) dispatch({ type: 'REPOS', list: r.list });
      else dispatch({ type: 'REPOS_FAILED', error: r.error });
      // The server no longer holds the connection (it expired, or was ended elsewhere): show the truth.
      if (!r.ok && r.code === 'NOT_CONNECTED') dispatch({ type: 'STATUS', status: { enabled: true, connected: false } });
    }, query.trim() ? FILTER_DEBOUNCE_MS : 0);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [withRepos, connected, query, reloads]);

  const more = useCallback(async () => {
    if (!state.list?.hasMore) return;
    dispatch({ type: 'REPOS_LOADING' });
    const r = await readGithubRepos({ page: state.list.page + 1, q: query });
    dispatch(r.ok ? { type: 'REPOS', list: r.list } : { type: 'REPOS_FAILED', error: r.error });
  }, [state.list, query]);

  const disconnect = useCallback(async () => {
    dispatch({ type: 'BUSY' });
    const r = await disconnectGithub();
    dispatch(r.ok ? { type: 'STATUS', status: r.status } : { type: 'ERROR', error: r.error });
  }, []);

  return {
    state,
    connect: startGithubConnect,
    disconnect,
    more,
    reload: () => setReloads((n) => n + 1),
    setQuery: (q: string) => dispatch({ type: 'SET_QUERY', query: q }),
  };
}
