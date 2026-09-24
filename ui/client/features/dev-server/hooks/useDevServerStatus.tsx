'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { pollIntervalMs } from '../domain/DevServerPolling';
import { fetchDevServer } from '../services/DevServerApi';
import { watchDevServerStatus } from '../services/DevServerPolling';
import { devServerReducer, initialDevServerSession } from '../workflows/DevServer';
import type { DevServerStatus } from '../types';

/** The dev server's status, polled because it can change with no request in flight (it can crash, the branch can be switched). */
export function useDevServerStatus() {
  const [session, dispatch] = useReducer(devServerReducer, initialDevServerSession);
  const issued = useRef(0);
  const applied = useRef(0);

  // A response older than one already shown is dropped, so a slow poll cannot put back a state that has passed.
  const take = useCallback((run: () => Promise<DevServerStatus>) => {
    issued.current += 1;
    const mine = issued.current;
    return run().then(
      (s) => {
        if (s && typeof s.state === 'string' && mine >= applied.current) {
          applied.current = mine;
          dispatch({ type: 'STATUS', status: s });
        }
        return s;
      },
      () => {
        dispatch({ type: 'UNREACHABLE' });
        return null;
      },
    );
  }, []);

  const refresh = useCallback(() => take(fetchDevServer), [take]);
  const state = session.status?.state;
  useEffect(() => watchDevServerStatus(refresh, pollIntervalMs(state)), [refresh, state]);

  return { session, dispatch, take };
}
