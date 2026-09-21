'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { listClones } from '../services/CloneReadApi';
import { forgetClone, readRecentClones } from '../services/CloneRecentStore';
import { pullClone } from '../services/CloneStartApi';
import { initialRecentState, recentReducer } from '../workflows/Recent';

/** The clones this browser started, checked against the server's clone jobs, with "Pull latest" for each. */
export function useRecentClones() {
  const [state, dispatch] = useReducer(recentReducer, initialRecentState);

  useEffect(() => {
    let stop = false;
    dispatch({ type: 'SET', items: readRecentClones() });
    (async () => {
      const jobs = await listClones();
      if (stop || !jobs) return;
      // A clone the server still remembers and did not finish is not a folder to open.
      const notDone = new Set(jobs.filter((j) => j.state !== 'done').map((j) => j.id));
      dispatch({ type: 'SET', items: readRecentClones().filter((r) => !notDone.has(r.id)) });
    })();
    return () => {
      stop = true;
    };
  }, []);

  const pull = useCallback(async (name: string, token: string) => {
    dispatch({ type: 'PULL_START', name });
    dispatch({ type: 'PULL_DONE', name, result: await pullClone(name, token) });
  }, []);

  const forget = useCallback((id: string) => dispatch({ type: 'SET', items: forgetClone(id) }), []);

  return { state, pull, forget };
}
