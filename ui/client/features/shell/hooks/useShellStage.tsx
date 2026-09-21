'use client';

import { createContext, useContext } from 'react';

/** What a screen may ask of the shell about the stage. Provided by the shell around every screen. */
export type ShellStageApi = { showStage: () => void };

const NOOP: ShellStageApi = { showStage: () => {} };

export const ShellStageContext = createContext<ShellStageApi>(NOOP);

/** Brings the stage (middle pane) into view. In the narrow one-pane layout choosing something in the Browser pane must
 * show its result, so a list calls this after a selection; in the wide layout the stage is always visible, so it does nothing.
 * A no-op outside the shell. */
export function useShellStage(): ShellStageApi {
  return useContext(ShellStageContext);
}
