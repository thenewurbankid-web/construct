import { GlassPanel } from '@/components/ui';
import type { PagesEditorNode } from '../types';

type PreviewNodeProps = {
  node: PagesEditorNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  titleFor: (node: PagesEditorNode) => string;
};

function PreviewNodeItem({ node, selectedId, onSelect, titleFor }: PreviewNodeProps) {
  const isSelected = node.id === selectedId;
  return (
    <div
      className={`preview-node${isSelected ? ' selected' : ''}${node.isCustomComponent ? ' component' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.id);
      }}
      title={titleFor(node)}
    >
      <div className="preview-node-label">{node.isFragment ? 'Fragment' : node.tag}</div>
      {node.children.length > 0 && (
        <div className="preview-node-children">
          {node.children.map((c) => (
            <PreviewNodeItem key={c.id} node={c} selectedId={selectedId} onSelect={onSelect} titleFor={titleFor} />
          ))}
        </div>
      )}
    </div>
  );
}

type PreviewPanelProps = {
  roots: PagesEditorNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  titleFor: (node: PagesEditorNode) => string;
};

// #51 — structural preview, bidirectionally linked to the tree via
// selectedId/onSelect. Presentation-only.
export function PreviewPanel({ roots, selectedId, onSelect, titleFor }: PreviewPanelProps) {
  return (
    <GlassPanel className="preview-panel">
      <h4>Live preview (structural mirror — see hint below)</h4>
      <p className="hint">
        Each box is one element from the same parse #50 produced. Click a box or a tree node — both
        select the same underlying node.
      </p>
      <div className="preview-canvas">
        {roots.map((r) => (
          <PreviewNodeItem key={r.id} node={r} selectedId={selectedId} onSelect={onSelect} titleFor={titleFor} />
        ))}
      </div>
    </GlassPanel>
  );
}
