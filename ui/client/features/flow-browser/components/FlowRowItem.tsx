'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import type { FlowRow, Relation } from '../types';

type FlowRowItemProps = {
  row: FlowRow;
  selected: boolean;
  collapsed: boolean;
  relation: Relation | undefined;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onOpen: (file: string) => void;
  onHover: (row: FlowRow, el: HTMLElement) => void;
  onLeave: () => void;
};

const TAG: Record<Relation, string> = { uses: 'selection uses this', usedBy: 'uses selection' };

// One line of the flow tree. A click selects; Ctrl/Cmd-click (or Ctrl/Cmd+Enter) opens the file through the
// same navigation the Pages editor uses (#321). A relation is told in words AND by a left edge, never colour alone.
export function FlowRowItem({ row, selected, collapsed, relation, onSelect, onToggle, onOpen, onHover, onLeave }: FlowRowItemProps) {
  const click = (e: MouseEvent<HTMLElement>) => {
    if ((e.ctrlKey || e.metaKey) && row.file) {
      e.preventDefault();
      onOpen(row.file);
    } else onSelect(row.id);
  };
  const key = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && row.file) {
      e.preventDefault();
      onOpen(row.file);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(row.id);
    }
  };

  if (row.kind === 'branch') {
    return (
      <div role="treeitem" aria-level={row.depth + 1} aria-expanded={!collapsed} className="flow-row flow-branch" style={{ paddingLeft: `calc(var(--sp-2) + ${row.depth} * 10px)` }} data-testid="flow-row" data-kind="branch">
        <button type="button" className="flow-twisty" aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${row.label}`} onClick={() => onToggle(row.id)}>
          {collapsed ? '▸' : '▾'}
        </button>
        <span>{row.label}</span>
        <span className="flow-meta">{row.count}</span>
      </div>
    );
  }

  const cls = ['flow-row', selected ? 'sel' : '', relation ? `rel-${relation}` : '', row.shownAbove ? 'shared' : ''].filter(Boolean).join(' ');
  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={row.hasChildren ? !collapsed : undefined}
      className={cls}
      style={{ paddingLeft: `calc(var(--sp-2) + ${row.depth} * 10px)` }}
      data-testid="flow-row"
      data-kind={row.kind}
      data-file={row.file ?? undefined}
      data-relation={relation}
      onClick={click}
      onKeyDown={key}
      onMouseEnter={(e) => onHover(row, e.currentTarget)}
      onMouseLeave={onLeave}
      onFocus={(e) => onHover(row, e.currentTarget)}
      onBlur={onLeave}
    >
      {row.hasChildren ? (
        <button
          type="button"
          className="flow-twisty"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${row.label}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(row.id);
          }}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      ) : (
        <span className="flow-twisty" aria-hidden="true" />
      )}
      <span className={`flow-layer layer-${row.layer}`}>{row.layer}</span>
      <span className="flow-name">{row.label}</span>
      {row.kind === 'route' && <span className="flow-meta">{row.count === 1 ? '1 feature' : `${row.count} features`}</span>}
      {row.kind === 'controller' && row.feature && <span className="flow-feat">{row.feature}</span>}
      {row.foreign && <span className="flow-feat">{row.feature}</span>}
      {row.shownAbove && <span className="flow-above">↑ shown above</span>}
      {relation && <span className={`flow-rtag ${relation}`}>{TAG[relation]}</span>}
    </div>
  );
}
