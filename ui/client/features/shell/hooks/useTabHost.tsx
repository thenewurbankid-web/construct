'use client';

import { useCallback, useRef, type KeyboardEvent } from 'react';
import { resolveActiveTab } from '../domain/TabRegistry';
import { nextTabId } from '../domain/TabKeys';
import type { ShellTab } from '../types';

/** Which tab is showing, and the tablist keyboard handler (roving focus:
 * Left/Right/Home/End move focus AND select, as the design's tabs are cheap). */
export function useTabHost(tabs: ShellTab[], activeId: string | null, onSelect: (id: string) => void) {
  const active = resolveActiveTab(tabs, activeId);
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>, currentId: string) => {
      const next = nextTabId(tabs, currentId, e.key);
      if (!next) return;
      e.preventDefault();
      onSelect(next);
      listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(next)}"]`)?.focus();
    },
    [tabs, onSelect],
  );

  return { active, listRef, onKeyDown };
}
