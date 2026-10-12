'use client';

import type { OpenModeData } from '../domain/OpenModes';

/** Two modes on "Open a project": what the chat reads, and Reopen / the sample opening a project at once, through the
 * same handler as the screen's buttons. */
export function useOpenModes(workspaceRoot: string | null, lastProject: string | null, samplePath: string | null, open: (dir: string) => void) {
  const data: OpenModeData = { workspaceRoot, lastProject, samplePath };
  const paths: Record<string, string | null> = { 'open.reopen': lastProject, 'open.sample': samplePath };
  const onOption = (optionId: string) => {
    const dir = paths[optionId];
    if (dir) open(dir);
  };
  return { data, onOption };
}
