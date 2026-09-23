import type { PagesEditorNode } from '../types';

type TreeNodeProps = { node: PagesEditorNode; selectedId: string | null; onSelect: (id: string) => void; depth: number };

function TreeNodeItem({ node, selectedId, onSelect, depth }: TreeNodeProps) {
  const isSelected = node.id === selectedId;
  return (
    <li>
      <div
        className={`tree-node${isSelected ? ' selected' : ''}${node.isCustomComponent ? ' component' : ''}`}
        style={{ paddingLeft: `${depth * 14}px` }}
        data-node-id={node.id}
        onClick={() => onSelect(node.id)}
      >
        <span className="tree-node-tag">{node.isFragment ? '<>' : `<${node.tag}>`}</span>
        {node.props.length > 0 && (
          <span className="tree-node-props"> {node.props.length} prop{node.props.length === 1 ? '' : 's'}</span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeNodeItem key={c.id} node={c} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

// #50 — JSX tree view. Presentation-only: just the `<ul class="tree-root">` content now (#536 —
// PagesBrowserTab.tsx owns the surrounding `.tree-panel` <details>/<summary> and, since that
// element is the actual scroll container, the auto-scroll-selection-into-view ref/effect too;
// this component no longer renders its own GlassPanel/heading).
export function TreePanel({ roots, selectedId, onSelect }: { roots: PagesEditorNode[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <ul className="tree-root">
      {roots.map((r) => (
        <TreeNodeItem key={r.id} node={r} selectedId={selectedId} onSelect={onSelect} depth={0} />
      ))}
    </ul>
  );
}
