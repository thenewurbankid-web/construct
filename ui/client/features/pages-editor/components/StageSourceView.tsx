'use client';

import { usePageSource } from '../hooks/usePageSource';
import { SourceEditor } from './SourceEditor';

type StageSourceViewProps = { feature: string; file: string; contentHash: string };

// The stage's Source tab (#375): the file open as an editor tab shows its full source
// read-only. Same data as the Tools "Source" tab (usePageSource) -- the tab itself is
// the open/closed state now, so there is no separate disclosure to expand.
export function StageSourceView({ feature, file, contentHash }: StageSourceViewProps) {
  const { source, markers, diagnostics, summary, summaryText, loading, error } = usePageSource(feature, file, contentHash, true);
  return (
    <div className="pe-stage-source">
      {loading && <p className="hint">Checking...</p>}
      {error && <p className="status-error">{error}</p>}
      {!error && !loading && (
        <span className={summary.errors ? 'status-error' : 'status-ok'} data-testid="stage-source-summary">
          {summaryText}
        </span>
      )}
      {!error && source !== '' && <SourceEditor value={source} markers={markers} readOnly label={`Source of ${file}`} />}
      {diagnostics.length > 0 && (
        <ul className="violation-list source-diagnostics" data-testid="stage-source-diagnostics">
          {diagnostics.map((d, i) => (
            <li key={i} className={`source-diagnostic ${d.severity}`}>
              <strong>{d.code}</strong> ({d.severity}) line {d.line}:{d.column} — {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
