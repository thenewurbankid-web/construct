'use client';

import { diagnosticsForNode, severityLabel } from '../domain/NodeDiagnostics';
import type { PageDiagnostics } from '../hooks/usePageDiagnostics';
import type { PagesEditorNode } from '../types';

type NodeDiagnosticsPanelProps = { diagnostics: PageDiagnostics | null; node: PagesEditorNode };

// #833 -- design 8.2's rule-violation callout: the SELECTED NODE's own violations (not the whole file's),
// sourced from the existing `validate`/architecture-enforcer output already fetched for the Source tab
// (`/api/pages/source`), not a new rules engine. The Source tab already renders every violation as a
// `SourceMarker` (`usePageSource`/`SourceMarkers.ts`, pre-existing) -- this panel only adds the per-node slice
// of that same data to the Inspector. Text-labelled severity, never colour only.
export function NodeDiagnosticsPanel({ diagnostics, node }: NodeDiagnosticsPanelProps) {
  const own = diagnostics?.ok ? diagnosticsForNode(node, diagnostics.diagnostics) : [];
  const summaryText =
    diagnostics === null ? 'checking…' : !diagnostics.ok ? 'unknown' : own.length === 0 ? '0 violations' : `${own.length} violation${own.length === 1 ? '' : 's'}`;
  return (
    <details className="node-diagnostics-panel pal-group" data-testid="node-diagnostics-panel">
      <summary>
        Rule violations <span className="pal-count" data-testid="node-diagnostics-count">{summaryText}</span>
      </summary>
      {diagnostics?.ok && (own.length === 0 ? (
        <p className="hint">No violations on this element.</p>
      ) : (
        <ul className="node-diagnostics-list" data-testid="node-diagnostics-list">
          {own.map((d, i) => (
            <li key={`${d.code}-${d.line}-${i}`}>
              <span className={`node-diagnostics-severity node-diagnostics-severity--${d.severity}`}>{severityLabel(d.severity)}</span> {d.message}
            </li>
          ))}
        </ul>
      ))}
    </details>
  );
}
