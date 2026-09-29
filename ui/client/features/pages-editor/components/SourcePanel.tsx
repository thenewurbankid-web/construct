'use client';

import { useEffect, useState } from 'react';
import { GlassPanel } from '@/components/ui';
import { usePageSource } from '../hooks/usePageSource';
import { useBufferLint } from '../hooks/useBufferLint';
import { useQuickFix } from '../hooks/useQuickFix';
import { SourceEditor } from './SourceEditor';
import { QuickFixPanel } from './QuickFixPanel';

type SourcePanelProps = { feature: string; file: string; contentHash: string };

// Collapsible code drill-down ("View/edit code") onto the page's full source: a
// Monaco editor whose markers (#551) come from linting the *unsaved* buffer
// (useBufferLint), replacing the old "diagnostics only refresh after a save"
// behaviour, plus a quick fix per diagnostic (Mechanical | AI, useQuickFix) shown
// as a reviewable diff before it lands in the draft. No save path from here yet
// — the only hash-guarded write path is still the per-node snippet/props editors
// above; this view is for reading and drafting a fix, not persisting one.
export function SourcePanel({ feature, file, contentHash }: SourcePanelProps) {
  const [open, setOpen] = useState(false);
  const { source, loading, error } = usePageSource(feature, file, contentHash, open);
  const [draft, setDraft] = useState('');
  useEffect(() => setDraft(source), [source]);

  const { markers, diagnostics, summary, summaryText } = useBufferLint(feature, file, draft, open && !loading && !error);
  const quickFix = useQuickFix(feature, file, draft, setDraft);

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
          {!error && draft !== '' && <SourceEditor value={draft} markers={markers} onChange={setDraft} label={`Source of ${file}`} />}
          {diagnostics.length > 0 && (
            <ul className="violation-list source-diagnostics" data-testid="source-diagnostics">
              {diagnostics.map((d, i) => (
                <li key={i} className={`source-diagnostic ${d.severity}`}>
                  <strong>{d.code}</strong> ({d.severity}) line {d.line}:{d.column} — {d.message}{' '}
                  <button type="button" onClick={() => quickFix.openMenu(d)} data-testid="quick-fix-open">
                    Quick fix
                  </button>
                  {quickFix.active && quickFix.rule === d.code && (
                    <QuickFixPanel
                      rule={d.code}
                      mechanicalFixAvailable={d.mechanicalFixAvailable}
                      mode={quickFix.mode}
                      hunks={quickFix.hunks}
                      busy={quickFix.busy}
                      error={quickFix.error}
                      onRequestFix={quickFix.requestFix}
                      onConfirm={quickFix.confirm}
                      onCancel={quickFix.closeMenu}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </GlassPanel>
  );
}
