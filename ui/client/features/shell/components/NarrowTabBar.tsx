'use client';

import { useNarrowTabBar } from '../hooks/useNarrowTabBar';
import type { NarrowTabBarProps } from '../types';

/** Bottom tab bar of the narrow layout: Browser / Stage / Tools, one pane at a time. */
export function NarrowTabBar({ pane, onSelect }: NarrowTabBarProps) {
  const { panes, listRef, onKeyDown } = useNarrowTabBar(pane, onSelect);
  return (
    <nav aria-label="Panes" className="sh-narrowbar">
      <div role="tablist" aria-label="Panes" className="sh-narrowlist" ref={listRef}>
        {panes.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            data-pane-tab={p.id}
            aria-selected={pane === p.id}
            aria-controls={p.id === 'mid' ? 'sh-mid' : `sh-pane-${p.id}`}
            tabIndex={pane === p.id ? 0 : -1}
            className="sh-narrowtab"
            onClick={() => onSelect(p.id)}
            onKeyDown={onKeyDown}
          >
            {p.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
