'use client';


import type { FlowHover, FlowRow, Relation } from '../types';
import { FlowRowItem } from './FlowRowItem';

type FlowTreeProps = {
  rows: FlowRow[];
  selectedId: string | null;
  collapsed: string[];
  /** file -> how it relates to the selection. */
  relations: Map<string, Relation>;
  hover: FlowHover | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onOpen: (file: string) => void;
  onHover: (row: FlowRow, el: HTMLElement) => void;
  onLeave: () => void;
};

// The route -> controller -> Behaviour path / Render path tree. Presentation-only; the rows are computed elsewhere.
export function FlowTree({ rows, selectedId, collapsed, relations, hover, onSelect, onToggle, onOpen, onHover, onLeave }: FlowTreeProps) {
  return (
    <>
      <div className="flow-tree" role="tree" aria-label="Flow: routes, controllers and the files they reach" data-testid="flow-tree">
        {rows.map((row) => (
          <FlowRowItem
            key={row.id}
            row={row}
            selected={row.id === selectedId}
            collapsed={collapsed.includes(row.id)}
            relation={row.file && row.id !== selectedId && row.kind !== 'route' ? relations.get(row.file) : undefined}
            onSelect={onSelect}
            onToggle={onToggle}
            onOpen={onOpen}
            onHover={onHover}
            onLeave={onLeave}
          />
        ))}
      </div>
      {hover && (
        <div className="ref-tip flow-tip" role="tooltip" data-testid="flow-tip" style={{ left: hover.x, top: hover.y }}>
          <div className="ref-tip-rel" data-testid="flow-tip-relation">{hover.hint.relation}</div>
          <div>{hover.hint.sentence}</div>
          {hover.hint.path && <div className="ref-tip-key" data-testid="flow-tip-path">{hover.hint.path}{hover.row.file ? ' · Ctrl+click to open' : ''}</div>}
        </div>
      )}
    </>
  );
}
