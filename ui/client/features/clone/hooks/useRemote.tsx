'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { connectRemote, readRemote } from '../services/RemoteApi';
import { initialRemoteState, remoteReducer } from '../workflows/Remote';

/** "Connect a remote": read whether the open project has an `origin`, and add one when it has none. */
export function useRemote() {
  const [state, dispatch] = useReducer(remoteReducer, initialRemoteState);

  useEffect(() => {
    let stop = false;
    readRemote().then((r) => {
      if (stop) return;
      dispatch(r.ok ? { type: 'LOADED', ...r.status } : { type: 'FAILED', error: r.error });
    });
    return () => {
      stop = true;
    };
  }, []);

  const connect = useCallback(async () => {
    dispatch({ type: 'BUSY' });
    const r = await connectRemote(state.url.trim());
    dispatch(r.ok ? { type: 'LOADED', ...r.status } : { type: 'FAILED', error: r.error });
  }, [state.url]);

  return { state, setUrl: (url: string) => dispatch({ type: 'SET_URL', url }), connect };
}
