'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useRailKeys } from '../hooks/useRailKeys';
import type { ActivityBarProps } from '../types';

const ICON: Record<string, ReactNode> = {
  features: <path d="M3 4h14v3H3zM3 9h14v3H3zM3 14h9v3H3z" />,
  pages: <path d="M5 2h7l4 4v12H5zM12 2v4h4" />,
  components: <path d="M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z" />,
  git: <path d="M6 3v10M6 13a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 3a2 2 0 1 0 0-.01M14 5a2 2 0 1 0 0-.01M14 7c0 4-8 3-8 6" />,
  tests: <path d="M4 10l4 4 8-9" />,
};

function Icon({ id }: { id: string }) {
  return (
    <svg className="sh-rail-icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {ICON[id] ?? <circle cx="10" cy="10" r="6" />}
    </svg>
  );
}

/** The screens rail: the five primary screens as an IDE-style activity bar (icon + label). Vertical on the left
 * of the frame, collapsible to icons only; on a phone the same component lays out as a horizontal bar above the
 * pane tabs. The current screen carries aria-current and a bar on its edge (not colour alone); the label stays
 * in the accessible name and the tooltip when the rail is collapsed. Presentation only (COMPONENT-*). */
export function ActivityBar({ screens, activeScreenId, screenBadges, collapsed, onToggleCollapsed, orientation }: ActivityBarProps) {
  const { listRef, onKeyDown } = useRailKeys(screens.length);
  const horizontal = orientation === 'horizontal';
  const activeIndex = screens.findIndex((s) => s.id === activeScreenId);
  const tabStop = activeIndex < 0 ? 0 : activeIndex;
  const cls = `sh-rail sh-rail--${orientation}${collapsed && !horizontal ? ' sh-rail--collapsed' : ''}`;
  return (
    <nav aria-label="Screens" className={cls} data-testid="screens-rail" data-collapsed={collapsed && !horizontal ? 'true' : 'false'}>
      {!horizontal && (
        <button
          type="button"
          className="sh-rail-toggle"
          data-testid="rail-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand the screens menu' : 'Collapse the screens menu'}
          title={collapsed ? 'Show screen names' : 'Hide screen names'}
          onClick={onToggleCollapsed}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d={collapsed ? 'M7 4l6 6-6 6' : 'M13 4l-6 6 6 6'} />
          </svg>
          <span className="sh-rail-label">Collapse</span>
        </button>
      )}
      <div className="sh-rail-list" ref={listRef}>
        {screens.map((screen, i) => {
          const active = screen.id === activeScreenId;
          const count = screenBadges?.[screen.id] ?? 0;
          return (
            <Link
              key={screen.id}
              href={screen.href}
              className={active ? 'sh-rail-link sh-rail-link--active' : 'sh-rail-link'}
              aria-current={active ? 'page' : undefined}
              tabIndex={i === tabStop ? 0 : -1}
              title={screen.label}
              data-rail-link=""
              data-testid={`screen-${screen.id}`}
              onKeyDown={onKeyDown}
            >
              <Icon id={screen.id} />
              <span className="sh-rail-label">{screen.label}</span>
              {count > 0 && (
                <span className="sh-topnav-badge sh-rail-badge" data-testid={`screen-${screen.id}-badge`}>
                  {count > 99 ? '99+' : count}
                  <span className="sh-sr-only"> {screen.id === 'git' ? 'branches under review' : 'items'}</span>
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
