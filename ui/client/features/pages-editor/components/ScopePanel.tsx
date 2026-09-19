'use client';

import { useScopeLinks } from '../hooks/useScopeLinks';
import { ScopeLinkGraph } from './ScopeLinkGraph';

type ScopePanelProps = { feature: string; file: string; nodeId: string; contentHash: string };

// #223 — which page-scope names (props, state, setters) flow into which of the selected element's
// props, plus flags for unbound / undeclared / unused ones.
export function ScopePanel({ feature, file, nodeId, contentHash }: ScopePanelProps) {
  const { view, error } = useScopeLinks(feature, file, nodeId, contentHash);
  return (
    <div className="scope-panel">
      <h4>Scope links</h4>
      {error && <p className="status-error">{error}</p>}
      {view && (
        <>
          <p className="hint">
            Page declarations (left) flowing into <code>&lt;{view.tag}&gt;</code> props (right).
          </p>
          {view.targets.length === 0 && view.sources.length === 0 ? (
            <p className="hint">Nothing in scope and no props on this element.</p>
          ) : (
            <ScopeLinkGraph view={view} />
          )}
          {view.flags.length > 0 && (
            <ul className="scope-flags">
              {view.flags.map((f, i) => (
                <li key={i} className={`scope-flag scope-flag-${f.level}`}>{f.text}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
