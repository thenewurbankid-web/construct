'use client';

import { useCallback, useEffect, useRef, type Dispatch } from 'react';
import { fetchProcesses } from '../services/ProcessesApi';
import { connectProcessesSocket } from '../services/ProcessesSocket';
import type { ProcessesAction } from '../types';

const RECONNECT_MS = 2000;

/** Keeps the process list current: an initial read, then the read-only socket, reconnecting when it
 * drops and re-reading on every (re)connect so nothing that changed while it was down is missed.
 * Re-runs when the project changes, since the server answers for one project at a time. */
export function useProcessesLive(projectDir: string | null, dispatch: Dispatch<ProcessesAction>) {
  const stopped = useRef(false);

  const reload = useCallback(async () => {
    const summaries = await fetchProcesses();
    if (summaries) dispatch({ type: 'LISTED', summaries });
    else dispatch({ type: 'LIST_FAILED', error: 'Could not read processes from the Construct server.' });
  }, [dispatch]);

  useEffect(() => {
    if (!projectDir) return undefined;
    stopped.current = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      ws = connectProcessesSocket({
        onOpen: () => { dispatch({ type: 'LIVE', live: true }); reload(); },
        onClose: () => {
          dispatch({ type: 'LIVE', live: false });
          if (!stopped.current) timer = setTimeout(open, RECONNECT_MS);
        },
        onUpdate: (detail) => dispatch({ type: 'UPDATE', detail }),
      });
    };
    reload();
    open();
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [projectDir, reload, dispatch]);

  return reload;
}
