'use client';

import { createContext, useContext } from 'react';

/** What a screen may ask of the shell's Tools pane. Provided by the shell around every screen. */
export type ShellToolsApi = { showTool: (id: string) => void };

const NOOP: ShellToolsApi = { showTool: () => {} };

export const ShellToolsContext = createContext<ShellToolsApi>(NOOP);

/** Brings a tab of the Tools pane into view: opens the pane, selects the tab, and in the narrow one-pane layout shows the
 * pane. A screen calls it when an action in another pane produced something that lives there (the Blocks tab's "Run this
 * block" adds a step to the plan). A no-op outside the shell. */
export function useShellTools(): ShellToolsApi {
  return useContext(ShellToolsContext);
}
