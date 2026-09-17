import { GlassPanel } from '@/components/ui';
import type { PageTree, PagesEditorNode } from '../types';
import { AutoMapPanel } from './AutoMapPanel';
import { PropRow } from './PropRow';
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
  const namedProps = node.props.filter((p) => p.kind !== 'spread');
  return (
    <GlassPanel className="inspector-panel">
      <SnippetEditor feature={feature} file={file} nodeId={node.id} contentHash={contentHash} onSaved={onSaved} />
      <div className="props-inspector">
        <h4>Props (#53)</h4>
        {node.isFragment ? (
          <p className="hint">Fragments have no props.</p>
        ) : namedProps.length === 0 ? (
          <p className="hint">No props on this node.</p>
        ) : (
          namedProps.map((p) => (
            <PropRow key={p.name} feature={feature} file={file} nodeId={node.id} contentHash={contentHash} prop={p} onSaved={onSaved} />
          ))
        )}
      </div>
      {node.isCustomComponent && (
        <AutoMapPanel feature={feature} file={file} nodeId={node.id} contentHash={contentHash} onSaved={onSaved} />
      )}
    </GlassPanel>
  );
}
