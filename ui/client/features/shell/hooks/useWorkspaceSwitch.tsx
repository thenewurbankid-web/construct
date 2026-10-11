'use client';

import { useCallback, useState } from 'react';
import { useLineWorkspace, workspaceLabel } from '@/lib/lineWorkspace';

/** Line cu6: the open project's workspace folder in the project switcher, and "Change workspace folder" (the in-project
 * folder picker open or closed). After a folder is stored the page reloads, as after a project switch, so every Line
 * screen re-reads which items are read-only. */
export function useWorkspaceSwitch(hasProject: boolean) {
  const workspace = useLineWorkspace();
  const [picking, setPicking] = useState(false);
  const { change } = workspace;
  const choose = useCallback(async (path: string) => {
    const refused = await change(path === '.' ? '' : path);
    if (refused) return;
    setPicking(false);
    window.location.reload();
  }, [change]);
  return {
    label: hasProject && workspace.folder !== null ? workspaceLabel(workspace.folder) : null,
    error: workspace.error,
    picking,
    startPicking: useCallback(() => setPicking(true), []),
    stopPicking: useCallback(() => setPicking(false), []),
    choose,
  };
}
