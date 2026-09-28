'use client';

import type { usePropFlow } from '../hooks/usePropFlow';

type OverlaysMenuProps = {
  flow: Pick<ReturnType<typeof usePropFlow>, 'visible' | 'toggle' | 'showValues' | 'toggleShowValues'>;
};

// #375 — one Overlays menu (design 8.1's revision of the first draft's 6 scattered toggles: "one
// 'Overlays' menu, at most one dot on an unselected row"). Flow is the only overlay wired today
// (the prop-flow diagram, formerly its own always-visible "Show diagram" panel); slice 11 (#379)
// adds Impact/Tests/Git/Findings/Notes as more items in the same menu, never a new one.
export function OverlaysMenu({ flow }: OverlaysMenuProps) {
  return (
    <details className="overlays-menu">
      <summary>Overlays</summary>
      <div className="overlays-menu-items">
        <label className="checkbox">
          <input type="checkbox" checked={flow.visible} onChange={flow.toggle} />
          Flow
        </label>
        {flow.visible && (
          <label className="checkbox propflow-show-values">
            <input type="checkbox" checked={flow.showValues} onChange={flow.toggleShowValues} />
            Show prop values
          </label>
        )}
      </div>
    </details>
  );
}
