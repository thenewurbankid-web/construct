import { useRef } from 'react';
import { GlassPanel } from '@/components/ui';
import type { PageTree, PagesEditorNode } from '../types';
import { AutoMapPanel } from './AutoMapPanel';
import { PropRow } from './PropRow';
import { ScopePanel } from './ScopePanel';
import { SnippetEditor } from './SnippetEditor';
import { SuggestedNextSteps } from './SuggestedNextSteps';

type InspectorPanelProps = {
  feature: string;
  file: string;
  node: PagesEditorNode | null;
  contentHash: string;
  onSaved: (tree: PageTree) => void;
  /** Show the scope links inline (default). The shell shows them as their own Scope tab instead. */
  withScope?: boolean;
};

export function InspectorPanel({ feature, file, node, contentHash, onSaved, withScope = true }: InspectorPanelProps) {
  // "Looks freshly created" (no props wired yet) is decided once, the moment a node is
  // selected, and kept for the rest of that selection — not re-checked on every render.
  // Otherwise a successful "Suggested next steps" run (e.g. auto-map wiring a prop) would
  // make its own condition go false and unmount its own result out from under the user.
  const emptyGate = useRef<{ id: string; show: boolean } | null>(null);
  if (node && !node.isFragment && (!emptyGate.current || emptyGate.current.id !== node.id)) {
    emptyGate.current = { id: node.id, show: node.props.length === 0 };
  }

  if (!node) return <p className="hint">Select a tree node or preview element to inspect it.</p>;
  // #77 follow-up to #53 — spread props (`{...rest}`) now render as rows
  // too (previously filtered out entirely); keyed by `index` rather than
  // `name` since a spread's `name` is null (would collide if a node ever
  // had more than one).
  const props = node.props;
  const showSuggestedNextSteps = !node.isFragment && emptyGate.current?.id === node.id && emptyGate.current.show;
  return (
    <GlassPanel className="inspector-panel">
      <SnippetEditor feature={feature} file={file} nodeId={node.id} contentHash={contentHash} onSaved={onSaved} />
      <div className="props-inspector">
        <h4>Props</h4>
        {node.isFragment ? (
          <p className="hint">Fragments have no props.</p>
        ) : props.length === 0 ? (
          <p className="hint">No props on this node.</p>
        ) : (
          props.map((p) => (
            <PropRow key={p.index} feature={feature} file={file} nodeId={node.id} contentHash={contentHash} prop={p} onSaved={onSaved} />
          ))
        )}
        {showSuggestedNextSteps && (
          <SuggestedNextSteps feature={feature} file={file} nodeId={node.id} contentHash={contentHash} onSaved={onSaved} />
        )}
      </div>
      {withScope && !node.isFragment && <ScopePanel feature={feature} file={file} node={node} contentHash={contentHash} onSaved={onSaved} />}
      {node.isCustomComponent && (
        <AutoMapPanel feature={feature} file={file} nodeId={node.id} contentHash={contentHash} onSaved={onSaved} />
      )}
    </GlassPanel>
  );
}
