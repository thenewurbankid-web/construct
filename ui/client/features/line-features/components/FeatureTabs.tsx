import type { FeatureTab } from '../types';

const TABS: { id: FeatureTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'workflows', label: 'Workflows' },
];

/** The chosen feature's tabs: Overview (what it owns, its summary and spec) and Workflows (state machines between its
 * pages). Arrow keys move between them, as in any tab list. */
export function FeatureTabs({ feature, tab, onTab }: { feature: string; tab: FeatureTab; onTab: (tab: FeatureTab) => void }) {
  const move = (dir: number) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + dir + TABS.length) % TABS.length];
    onTab(next.id);
    document.getElementById(`lf-tab-${next.id}`)?.focus();
  };
  const tabButton = (t: { id: FeatureTab; label: string }) => (
    <button
      key={t.id}
      id={`lf-tab-${t.id}`}
      type="button"
      role="tab"
      className="lf-tab"
      aria-selected={t.id === tab}
      aria-controls={t.id === tab ? `lf-panel-${t.id}` : undefined}
      tabIndex={t.id === tab ? 0 : -1}
      onClick={() => onTab(t.id)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') move(1);
        if (e.key === 'ArrowLeft') move(-1);
      }}
    >
      {t.label}
    </button>
  );
  return (
    <div className="lf-tabs" role="tablist" aria-label={`What to show for ${feature}`}>
      {TABS.map(tabButton)}
    </div>
  );
}
