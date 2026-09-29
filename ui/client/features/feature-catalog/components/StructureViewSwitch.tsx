export type StructureView = 'tree' | 'flow';

const OPTIONS: { id: StructureView; label: string }[] = [
  { id: 'tree', label: 'Tree' },
  { id: 'flow', label: 'Flow' },
];

/** Tree | Flow switch above the feature structure (#790). Same look as the Pages editor's Files | Flow
 * switch (`.flow-switch`, `ui/client/app/flow-browser.css`, loaded globally) -- a different choice, so its
 * own local state rather than the shared per-project Files | Flow one (@/features/flow-browser's
 * useBrowserView), which would otherwise cross-couple the two screens' toggles. */
export function StructureViewSwitch({ view, onChange }: { view: StructureView; onChange: (view: StructureView) => void }) {
  return (
    <div className="flow-switch" role="radiogroup" aria-label="Feature structure view" data-testid="fc-view-switch">
      {OPTIONS.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={view === o.id} className={view === o.id ? 'on' : ''} data-testid={`fc-view-${o.id}`} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
