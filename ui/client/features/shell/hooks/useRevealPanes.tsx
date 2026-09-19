'use client';

import { useEffect } from 'react';
import type { PaneId } from '../types';

/** A screen that puts tabs into a pane wants it visible: open that pane when
 * its first tab appears (only on that transition, so collapsing it afterwards
 * sticks). Waits for the project's saved layout to load first, or that load
 * would overwrite the reveal. */
export function useRevealPanes(
  projectKnown: boolean,
  projectDir: string | null,
  wanted: { left: boolean; right: boolean },
  toggle: (pane: PaneId, open?: boolean) => void,
): void {
  const { left, right } = wanted;
  useEffect(() => {
    if (projectKnown && left) toggle('left', true);
  }, [projectKnown, projectDir, left, toggle]);
  useEffect(() => {
    if (projectKnown && right) toggle('right', true);
  }, [projectKnown, projectDir, right, toggle]);
}
