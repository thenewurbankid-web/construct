import type { BrowserView } from '../types';

const OPTIONS: { id: BrowserView; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'flow', label: 'Flow' },
];

/** The Files | Flow switch at the top of the Browser pane. Presentation-only. */
export function BrowserViewSwitch({ view, onChange }: { view: BrowserView; onChange: (view: BrowserView) => void }) {
  return (
    <div className="flow-switch" role="radiogroup" aria-label="Browser view" data-testid="browser-view-switch">
      {OPTIONS.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={view === o.id} className={view === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
