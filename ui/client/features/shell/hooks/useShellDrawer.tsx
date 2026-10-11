'use client';

import { createContext, useContext } from 'react';

/** What a screen may ask of the shell's drawer. Provided by the shell around every screen. */
export type ShellDrawerApi = {
  openProcesses: () => void;
  openLogs: () => void;
  /** Re-runs validate in the background, so Diagnostics and the status bar follow a change a screen just made. */
  revalidate: () => void;
};

const NOOP: ShellDrawerApi = { openProcesses: () => {}, openLogs: () => {}, revalidate: () => {} };

export const ShellDrawerContext = createContext<ShellDrawerApi>(NOOP);

/** Lets a screen open the Processes or Logs tab of the drawer (for example after it starts a process, or to show a dev server's output). A no-op outside the shell. */
export function useShellDrawer(): ShellDrawerApi {
  return useContext(ShellDrawerContext);
}
