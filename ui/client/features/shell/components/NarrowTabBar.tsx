'use client';

import { useNarrowTabBar } from '../hooks/useNarrowTabBar';
import type { NarrowTabBarProps } from '../types';

/** Bottom tab bar of the narrow layout: Browser / Stage / Tools / Run, one pane at a time.
 * Run (the bottom panel) carries the running-process count, like the wide layout's processes pill. */
export function NarrowTabBar({ pane, onSelect, runBadge = 0 }: NarrowTabBarProps) {
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
            {p.id === 'drawer' && runBadge > 0 && (
              <span className="sh-topnav-badge sh-narrowtab-badge" data-testid="narrow-run-badge">
                {runBadge > 99 ? '99+' : runBadge}
                <span className="sh-sr-only"> running</span>
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
