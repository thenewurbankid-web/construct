'use client';

import { useScopeLinks } from '../hooks/useScopeLinks';
import { useScopeBind } from '../hooks/useScopeBind';
import { ScopeLinkGraph } from './ScopeLinkGraph';
import { SaveStatus } from './SaveStatus';
import type { PageTree, PagesEditorNode } from '../types';

type ScopePanelProps = { feature: string; file: string; node: PagesEditorNode; contentHash: string; onSaved: (tree: PageTree) => void };

// #223 — which page-scope names (props, state, setters, providers, other units' outputs) flow into
// which of the selected element's props, plus flags for unbound / undeclared / unused ones.
// #534 — now interactive: a target's "Bind…" arms it, a fitting scope candidate commits the rewire.
export function ScopePanel({ feature, file, node, contentHash, onSaved }: ScopePanelProps) {
  const { view, error } = useScopeLinks(feature, file, node.id, contentHash);
  const { armed, arm, cancel, commit, busy, status } = useScopeBind(feature, file, node, contentHash, onSaved);
  const armedTarget = armed && view ? view.targets.find((t) => t.prop === armed) ?? null : null;
  return (
    <div className="scope-panel">
      <h4>Scope links</h4>
      {error && <p className="status-error">{error}</p>}
      {view && (
        <>
          <p className="hint">
            Page declarations (left) flowing into <code>&lt;{view.tag}&gt;</code> props (right). Press a
            prop on the right to bind it to one of the values on the left.
          </p>
          {armedTarget && (
            <p className="scope-callout">
              Linking: {armedTarget.prop}
              {armedTarget.type ? ` (${armedTarget.type})` : ''} — pick a matching value on the left, or press{' '}
              <kbd>Esc</kbd> to cancel.
            </p>
          )}
          {view.targets.length === 0 && view.sources.length === 0 ? (
            <p className="hint">Nothing in scope and no props on this element.</p>
          ) : (
            <ScopeLinkGraph view={view} armed={armed} onArm={arm} onCancel={cancel} onCommit={commit} busy={busy} />
          )}
          {status && <SaveStatus status={status} />}
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
