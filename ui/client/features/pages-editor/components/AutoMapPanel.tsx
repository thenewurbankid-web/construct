'use client';

import { useAutoMap } from '../hooks/useAutoMap';
import type { PageTree } from '../types';
import { SaveStatus } from './SaveStatus';

type AutoMapPanelProps = {
  feature: string;
  file: string;
  nodeId: string;
  contentHash: string;
  onSaved: (tree: PageTree) => void;
};

// #54 — auto-map unmapped child props onto the parent component.
export function AutoMapPanel({ feature, file, nodeId, contentHash, onSaved }: AutoMapPanelProps) {
  const { candidates, checked, find, toggle, apply, busy, status, childPropsResolved } = useAutoMap(feature, file, nodeId, contentHash, onSaved);
  return (
    <div className="automap-panel">
      <h4>Auto-map unmapped props</h4>
      <p className="hint">
        Compares this component&apos;s JSX attributes against the enclosing page&apos;s own props
        (destructured function params) and <code>useState</code> names — any of those not currently
        passed down as a same-named attribute is offered as a shorthand <code>{'{name}'}</code>{' '}
        wire-up. When the child component&apos;s own file can be resolved from the page&apos;s
        import, candidates are additionally filtered to names the child actually declares.
      </p>
      <button type="button" onClick={find}>Find unmapped props</button>
      {candidates && (
        <>
          <p className="hint automap-resolution-status">
            {childPropsResolved
              ? 'Filtered to props the child component actually declares.'
              : "Could not resolve the child component's own props across files — showing every in-scope name instead."}
          </p>
          {candidates.length === 0 ? (
            <p className="hint">Nothing unmapped.</p>
          ) : (
            <ul className="automap-candidates">
              {candidates.map((name) => (
                <li key={name}>
                  <label className="checkbox">
                    <input type="checkbox" checked={checked.has(name)} onChange={() => toggle(name)} />
                    {name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {candidates.length > 0 && (
            <button type="button" onClick={apply} disabled={busy || checked.size === 0}>
              {busy ? 'Applying…' : `Wire ${checked.size} prop(s)`}
            </button>
          )}
        </>
      )}
      {status && <SaveStatus status={status} />}
    </div>
  );
}
