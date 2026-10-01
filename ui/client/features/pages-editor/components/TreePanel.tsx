import type { PagesEditorNode } from '../types';
import type { PageImpact } from '../services/ImpactApi';
import type { PageGitStatus } from '../services/GitStatusApi';

type TreeNodeProps = {
  node: PagesEditorNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth: number;
  /** #379/#829 -- the open file's Impact/Git signals (one file, shown on whichever row is selected;
      see TreePanel's own comment on why a per-node file isn't resolved yet). */
  impact: PageImpact | null;
  gitStatus: PageGitStatus | null;
};

function TreeNodeItem({ node, selectedId, onSelect, depth, impact, gitStatus }: TreeNodeProps) {
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
        {/* #375 — quiet tree: chips show only on the selected row. #379/#829 add the first two real
            ones (Impact, computed for the open file, not per node — see ImpactPanel's own comment);
            Tests/Findings/Notes/Rules follow in #830-#833. */}
        {isSelected && node.props.length > 0 && (
          <span className="tree-node-props"> {node.props.length} prop{node.props.length === 1 ? '' : 's'}</span>
        )}
        {isSelected && impact?.ok && impact.features.length > 0 && (
          <span className="tree-node-impact" data-testid="tree-node-impact" title={`Touches ${impact.features.length} other feature(s): ${impact.features.join(', ')}`}>
            {' '}{impact.features.length} feat
          </span>
        )}
        {/* #829 -- git-changed is a whole-FILE fact (no per-node line diff yet), so the dot can only
            honestly mark the file's own root row, not every descendant (that would defeat "quiet").
            At most one dot, and only on an UNselected row (the quiet-tree rule). */}
        {!isSelected && depth === 0 && gitStatus?.ok && gitStatus.changed && (
          <span className="tree-node-dot tree-node-dot-git" data-testid="tree-node-dot-git" title="Changed vs main" aria-label="Changed vs main" />
        )}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeNodeItem key={c.id} node={c} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} impact={impact} gitStatus={gitStatus} />
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
type TreePanelProps = {
  roots: PagesEditorNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  impact?: PageImpact | null;
  gitStatus?: PageGitStatus | null;
};

export function TreePanel({ roots, selectedId, onSelect, impact = null, gitStatus = null }: TreePanelProps) {
  return (
    <ul className="tree-root">
      {roots.map((r) => (
        <TreeNodeItem key={r.id} node={r} selectedId={selectedId} onSelect={onSelect} depth={0} impact={impact} gitStatus={gitStatus} />
      ))}
    </ul>
  );
}
