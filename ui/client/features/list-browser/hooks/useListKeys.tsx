'use client';

import { useCallback, useRef, type KeyboardEvent } from 'react';
import { isSelectKey, listNextIndex } from '../domain/ListNav';

/** Keyboard handling of a listbox with one tab stop: Up/Down/Home/End move focus between the rows, Enter (or Space)
 * selects the focused one. From the filter box, Down goes to the first row. Rows carry `data-list-row`. */
export function useListKeys(onSelectId: (id: string) => void) {
  const listRef = useRef<HTMLUListElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const rows = useCallback(() => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-list-row]') ?? []), []);

  const onRowKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (isSelectKey(e.key)) {
        e.preventDefault();
        const id = e.currentTarget.getAttribute('data-id');
        if (id) onSelectId(id);
        return;
      }
      const all = rows();
      const next = listNextIndex(e.key, all.indexOf(e.currentTarget), all.length);
      if (next === null) return;
      e.preventDefault();
      all[next]?.focus();
    },
    [rows, onSelectId],
  );

  const onFilterKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'ArrowDown') return;
      const first = rows()[0];
      if (!first) return;
      e.preventDefault();
      first.focus();
    },
    [rows],
  );

  return { listRef, filterRef, onRowKeyDown, onFilterKeyDown };
}
