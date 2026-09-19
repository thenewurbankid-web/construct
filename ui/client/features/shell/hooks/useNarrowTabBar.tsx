'use client';

import { useCallback, useRef, type KeyboardEvent } from 'react';
import { NARROW_PANES, nextNarrowPane } from '../domain/NarrowPanes';
import type { NarrowPane } from '../types';

/** Entries and roving-focus keyboard handling of the narrow bottom tab bar
 * (Left/Right/Home/End move focus and select, like the region tab lists). */
export function useNarrowTabBar(pane: NarrowPane, onSelect: (pane: NarrowPane) => void) {
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const next = nextNarrowPane(pane, e.key);
      if (!next) return;
      e.preventDefault();
      onSelect(next);
      listRef.current?.querySelector<HTMLElement>(`[data-pane-tab="${next}"]`)?.focus();
    },
    [pane, onSelect],
  );
  return { panes: NARROW_PANES, listRef, onKeyDown };
}
