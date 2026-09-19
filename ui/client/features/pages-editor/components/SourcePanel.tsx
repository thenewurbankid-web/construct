'use client';

import { useState } from 'react';
import { GlassPanel } from '@/components/ui';
import { usePageSource } from '../hooks/usePageSource';
import { SourceEditor } from './SourceEditor';

type SourcePanelProps = { feature: string; file: string; contentHash: string };

// Collapsible read-only view of the page's full source with live TypeScript /
// architecture diagnostics as editor markers plus a plain list. Read-only on
// purpose: the only hash-guarded write path is the per-node snippet/props
// editors above, and this view refreshes after each of their saves.
export function SourcePanel({ feature, file, contentHash }: SourcePanelProps) {
  const [open, setOpen] = useState(false);
  const { source, markers, diagnostics, summary, summaryText, loading, error } = usePageSource(feature, file, contentHash, open);

  return (
    <GlassPanel className="source-panel">
      <div className="source-panel-header">
        <h3>Source</h3>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide source' : 'View source'}
        </button>
        {open && !loading && !error && (
          <span className={summary.errors ? 'status-error' : 'status-ok'} data-testid="source-summary">
            {summaryText}
          </span>
        )}
      </div>
      {open && (
        <>
          {loading && <p className="hint">Checking...</p>}
          {error && <p className="status-error">{error}</p>}
          {!error && source !== '' && <SourceEditor value={source} markers={markers} readOnly label={`Source of ${file}`} />}
          {diagnostics.length > 0 && (
            <ul className="violation-list source-diagnostics" data-testid="source-diagnostics">
              {diagnostics.map((d, i) => (
                <li key={i} className={`source-diagnostic ${d.severity}`}>
                  <strong>{d.code}</strong> ({d.severity}) line {d.line}:{d.column} — {d.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </GlassPanel>
  );
}
