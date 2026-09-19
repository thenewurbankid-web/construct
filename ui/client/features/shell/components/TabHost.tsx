'use client';

import { useTabHost } from '../hooks/useTabHost';
import type { TabHostProps } from '../types';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** Renders a region's registered tabs (id, title, badge, render): an ARIA
 * tablist plus the active tab's panel. Knows nothing about what the tabs
 * contain, so any feature can register into it. */
export function TabHost({ label, tabs, activeId, onSelect, empty }: TabHostProps) {
  const { active, listRef, onKeyDown } = useTabHost(tabs, activeId, onSelect);
  const prefix = `sh-${slug(label)}`;
  return (
    <div className="sh-tabhost" data-testid={`tabhost-${slug(label)}`}>
      <div role="tablist" aria-label={label} className="sh-tablist" ref={listRef}>
        {tabs.map((tab) => {
          const selected = active?.id === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${prefix}-tab-${tab.id}`}
              data-tab-id={tab.id}
              aria-selected={selected}
              aria-controls={`${prefix}-panel`}
              tabIndex={selected ? 0 : -1}
              disabled={tab.disabled}
              className="sh-tab"
              onClick={() => onSelect(tab.id)}
              onKeyDown={(e) => onKeyDown(e, tab.id)}
            >
              {tab.title}
              {tab.badge !== undefined && (
                <span className="sh-badge" aria-label={`${tab.badge} ${tab.title}`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${prefix}-panel`}
        aria-labelledby={active ? `${prefix}-tab-${active.id}` : undefined}
        tabIndex={0}
        className="sh-tabpanel"
      >
        {active ? active.render() : (empty ?? <p className="sh-empty">Nothing here yet.</p>)}
      </div>
    </div>
  );
}
