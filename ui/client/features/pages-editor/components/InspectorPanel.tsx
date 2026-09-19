import { GlassPanel } from '@/components/ui';
import type { PageTree, PagesEditorNode } from '../types';
import { AutoMapPanel } from './AutoMapPanel';
import { PropRow } from './PropRow';
import { ScopePanel } from './ScopePanel';
import { SnippetEditor } from './SnippetEditor';

type InspectorPanelProps = {
  feature: string;
  file: string;
  node: PagesEditorNode | null;
  contentHash: string;
  onSaved: (tree: PageTree) => void;
};

export function InspectorPanel({ feature, file, node, contentHash, onSaved }: InspectorPanelProps) {
  if (!node) return <p className="hint">Select a tree node or preview element to inspect it.</p>;
  // #77 follow-up to #53 — spread props (`{...rest}`) now render as rows
  // too (previously filtered out entirely); keyed by `index` rather than
  // `name` since a spread's `name` is null (would collide if a node ever
  // had more than one).
  const props = node.props;
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
      </div>
      {!node.isFragment && <ScopePanel feature={feature} file={file} nodeId={node.id} contentHash={contentHash} />}
      {node.isCustomComponent && (
        <AutoMapPanel feature={feature} file={file} nodeId={node.id} contentHash={contentHash} onSaved={onSaved} />
      )}
    </GlassPanel>
  );
}
