'use client';

import type { PageImpact } from '../services/ImpactApi';

type ImpactPanelProps = { impact: PageImpact | null };

// #379 -- design 8.2's "Impact" inspector section: deterministic blast radius (packages/engine/
// impact.mjs via /api/pages/impact), collapsed by default and one-line while closed, the same
// `.pal-group` disclosure Scope/Auto-map already use (docs/design/browser-panel-merge.md).
// #829 lifted the fetch (useImpact) up to usePagesEditorTabs so the tree-row chip can share the
// same one request instead of fetching Impact twice.
export function ImpactPanel({ impact }: ImpactPanelProps) {
  const summaryText =
    impact === null ? 'checking…' : !impact.ok ? 'unknown' : impact.features.length === 0 ? '0 features' : `${impact.features.length} feature${impact.features.length === 1 ? '' : 's'}`;
  return (
    <details className="impact-panel pal-group" data-testid="impact-panel">
      <summary>
        Impact <span className="pal-count" data-testid="impact-count">{summaryText}</span>
      </summary>
      {impact?.ok && (impact.features.length === 0 ? (
        <p className="hint">No other feature imports this file.</p>
      ) : (
        <ul className="impact-features" data-testid="impact-feature-list">
          {impact.features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ))}
    </details>
  );
}
