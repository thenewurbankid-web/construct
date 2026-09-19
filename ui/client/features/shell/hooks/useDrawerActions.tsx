'use client';

import { useCallback } from 'react';
import type { PaneId, ShellRegion } from '../types';

/** Opens the drawer on a given tab (used by the Processes pill, the status bar and palette commands). */
export function useDrawerActions(toggle: (pane: PaneId, open?: boolean) => void, select: (region: ShellRegion, id: string) => void) {
  const showDrawerTab = useCallback(
    (tab: string) => {
      toggle('drawer', true);
      select('drawer', tab);
    },
    [toggle, select],
  );
  return { showDrawerTab };
}
