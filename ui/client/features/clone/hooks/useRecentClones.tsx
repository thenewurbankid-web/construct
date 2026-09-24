'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { listClones } from '../services/CloneReadApi';
import { forgetClone, readRecentClones } from '../services/CloneRecentStore';
import { pullClone } from '../services/CloneStartApi';
import { initialRecentState, recentReducer } from '../workflows/Recent';

/** The clones this browser started, checked against the server's clone jobs, with "Open" and an update for each.
 * `onOpen` receives the folder of a recent clone (the Open-a-project screen opens it). */
export function useRecentClones(onOpen: (dir: string) => void) {
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

  const byId = useCallback((id: string) => state.items.find((r) => r.id === id), [state.items]);

  const open = useCallback((id: string) => {
    const r = byId(id);
    if (r) onOpen(r.dir);
  }, [byId, onOpen]);

  const pull = useCallback(async (id: string, token: string, useLogin = false) => {
    const r = byId(id);
    if (!r) return;
    dispatch({ type: 'PULL_START', name: r.name });
    dispatch({ type: 'PULL_DONE', name: r.name, result: await pullClone(r.name, token, useLogin) });
  }, [byId]);

  const forget = useCallback((id: string) => dispatch({ type: 'SET', items: forgetClone(id) }), []);

  return { state, open, pull, forget };
}
