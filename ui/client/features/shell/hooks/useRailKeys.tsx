'use client';

import { useCallback, useRef, type KeyboardEvent } from 'react';
import { railNextIndex } from '../domain/RailKeys';

/** Roving-focus keyboard handling of the screens rail: arrows / Home / End move focus between the screen links
 * (only one is in the tab order); Enter is the link's own activation. */
export function useRailKeys(count: number) {
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const links = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-rail-link]') ?? []);
      const index = links.indexOf(e.currentTarget);
      const next = railNextIndex(e.key, index < 0 ? 0 : index, count);
      if (next === null) return;
      e.preventDefault();
      links[next]?.focus();
    },
    [count],
  );
  return { listRef, onKeyDown };
}
