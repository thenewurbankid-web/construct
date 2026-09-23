'use client';

import { useCallback, useMemo } from 'react';
import { buildDevServerView } from '../domain/DevServerView';
import { restartDevServer, startDevServer, stopDevServer } from '../services/DevServerActions';
import { hasSeenCommand, rememberCommand } from '../services/DevServerAck';
import type { DevServerStatus } from '../types';
import { useDevServerStatus } from './useDevServerStatus';

/**
 * The open project's dev server and the four things a person can do: Start, Restart, Stop, and "Use port N".
 * Nothing here ever starts a server unasked: the only callers of `startDevServer` are `confirmStart`, `requestStart`
 * and `startOnPort`, all reached from a click, and the first start of a project's command goes through a one-time
 * "this is what will run" confirmation.
 */
export function useDevServer() {
  const { session, dispatch, take } = useDevServerStatus();
  const { status, busy, confirming, error } = session;
  const root = status?.root ?? null;
  const commandText = status?.command?.text ?? null;

  const act = useCallback(async (run: () => Promise<DevServerStatus>) => {
    dispatch({ type: 'BUSY', busy: true });
    await take(run);
    dispatch({ type: 'BUSY', busy: false });
  }, [dispatch, take]);

  const start = useCallback((port?: number) => act(() => startDevServer(port)), [act]);

  /** The Start click: runs at once when this project's command has been seen, otherwise asks first. */
  const requestStart = useCallback(() => {
    if (hasSeenCommand(root, commandText)) return start();
    dispatch({ type: 'CONFIRMING', on: true });
    return Promise.resolve();
  }, [root, commandText, start, dispatch]);

  const confirmStart = useCallback(() => {
    rememberCommand(root, commandText);
    dispatch({ type: 'CONFIRMING', on: false });
    return start();
  }, [root, commandText, start, dispatch]);

  const cancelConfirm = useCallback(() => dispatch({ type: 'CONFIRMING', on: false }), [dispatch]);
  const stop = useCallback(() => act(stopDevServer), [act]);
  const restart = useCallback(() => act(() => restartDevServer()), [act]);

  const acknowledged = hasSeenCommand(root, commandText);
  const view = useMemo(() => buildDevServerView(status, { acknowledged, confirming, busy }), [status, acknowledged, confirming, busy]);

  return { status, view, error, requestStart, confirmStart, cancelConfirm, stop, restart, startOnPort: start };
}
