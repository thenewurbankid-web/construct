'use client';

import { createContext, useContext } from 'react';

/** What a screen may ask of the shell's drawer. Provided by the shell around every screen. */
export type ShellDrawerApi = { openProcesses: () => void };

const NOOP: ShellDrawerApi = { openProcesses: () => {} };

export const ShellDrawerContext = createContext<ShellDrawerApi>(NOOP);

/** Lets a screen open the Processes tab of the drawer (for example after it starts a process). A no-op outside the shell. */
export function useShellDrawer(): ShellDrawerApi {
  return useContext(ShellDrawerContext);
}
