import type { ChangeTreeProps, TreeNavProps, TreeNodeView } from '../types';

const GROUPINGS: { id: ChangeTreeProps['grouping']; label: string }[] = [
  { id: 'feature', label: 'By feature' },
  { id: 'layer', label: 'By layer' },
  { id: 'files', label: 'Files' },
];

type NodeProps = {
  node: TreeNodeView;
  level: number;
  posinset: number;
  setsize: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  nav: TreeNavProps;
};

/** One row of the tree. Presentation only: the keyboard model lives in domain/TreeNav.ts and hooks/useTreeNavigation.tsx. */
function TreeNode({ node, level, posinset, setsize, selectedPath, onSelect, nav }: NodeProps) {
  const isParent = node.children.length > 0;
  const open = isParent && nav.isOpen(node.id);
  const selected = node.file !== null && node.file.path === selectedPath;
  const activate = () => {
    if (node.file) onSelect(node.file.path);
    else nav.onToggle(node.id);
  };
  return (
    <li
      role="treeitem"
      className={`rv-node rv-node--${node.kind}`}
      data-node-id={node.id}
      data-testid={node.testId}
      {...node.data}
      tabIndex={nav.tabStopId === node.id ? 0 : -1}
      aria-level={level}
      aria-posinset={posinset}
      aria-setsize={setsize}
      aria-expanded={isParent ? open : undefined}
      aria-selected={node.file ? selected : undefined}
      aria-current={selected ? 'true' : undefined}
      title={node.file?.path}
      onFocus={(e) => { if (e.target === e.currentTarget) nav.onFocusRow(node.id); }}
    >
      <div className={node.file ? 'rv-node-row rv-file' : `rv-node-row ${node.kind === 'feature' ? 'rv-feature' : 'rv-layer'}`} onClick={activate}>
        {isParent && <span className="rv-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>}
        {node.file ? (
          <>
            <span className="rv-file-name">{node.label}</span>
            {node.showLayer && <span className="rv-chip">{node.file.layer ?? 'other'}</span>}
            {node.file.status !== 'M' && <span className={`rv-status rv-status--${node.file.status}`}>{node.file.statusLabel}</span>}
          </>
        ) : (
          <>
            <span className={node.kind === 'feature' ? 'rv-feature-name' : 'rv-chip'}>{node.label}</span>
            <span className="rv-count">{node.kind === 'feature' ? `${node.count} ${node.count === 1 ? 'file' : 'files'}` : node.count}</span>
          </>
        )}
      </div>
      {isParent && open && (
        <ul role="group" className="rv-tree rv-tree--inner">
          {node.children.map((c, i) => (
            <TreeNode key={c.id} node={c} level={level + 1} posinset={i + 1} setsize={node.children.length} selectedPath={selectedPath} onSelect={onSelect} nav={nav} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Browser pane of one change: CHANGED UNITS GROUPED BY FEATURE THEN LAYER (or by layer, or flat), as an ARIA tree with one tab stop. */
export function ChangeTree({ grouping, onGrouping, totals, ariaLabel, nodes, selectedPath, onSelect, nav }: ChangeTreeProps) {
  return (
    <div className="rv-side" data-testid="review-tree">
      <div className="rv-toggle rv-toggle--tabs" role="group" aria-label="Group changed units">
        {GROUPINGS.map((g) => (
          <button key={g.id} type="button" aria-pressed={grouping === g.id} data-testid={`review-group-${g.id}`} onClick={() => onGrouping(g.id)}>{g.label}</button>
        ))}
      </div>
      <p className="rv-hint" data-testid="review-totals">{totals}</p>
      {nodes.length === 0 ? (
        <p className="hint" data-testid="review-tree-empty">No changed files.</p>
      ) : (
        <ul role="tree" className="rv-tree" aria-label={ariaLabel} ref={nav.treeRef} onKeyDown={nav.onKeyDown}>
          {nodes.map((n, i) => (
            <TreeNode key={n.id} node={n} level={1} posinset={i + 1} setsize={nodes.length} selectedPath={selectedPath} onSelect={onSelect} nav={nav} />
          ))}
        </ul>
      )}
    </div>
  );
}
