import type { KeyboardEvent } from 'react';
import type { KnowsTab, KnowsTabId } from '@/lib/lineKnowsContract';

/** The four tabs as an ARIA tablist (arrow keys move between them). */
export function KnowsTabBar({ tabs, current, onPick }: { tabs: KnowsTab[]; current: KnowsTabId; onPick: (id: KnowsTabId) => void }) {
  const move = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    onPick(next.id);
    document.getElementById(`knows-tab-${next.id}`)?.focus();
  };
  return (
    <div className="lk-tabs" role="tablist" aria-label="What Line knows">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          id={`knows-tab-${t.id}`}
          type="button"
          role="tab"
          className="lk-tab"
          aria-selected={t.id === current}
          aria-controls={`knows-panel-${t.id}`}
          tabIndex={t.id === current ? 0 : -1}
          data-testid={`knows-tab-${t.id}`}
          onClick={() => onPick(t.id)}
          onKeyDown={(e) => move(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
