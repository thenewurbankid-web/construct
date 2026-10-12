// @line-level molecule
'use client';
import type { ReactNode } from 'react';

export type TableColumn = { key: string; header: string; sortable?: boolean };
export type TableRow = { id: string } & Record<string, ReactNode>;
export type TableSort = { column: string; direction: 'ascending' | 'descending' };

export type TableProps = {
  /** Names the table (a visible caption). */
  caption: string;
  columns: TableColumn[];
  rows: TableRow[];
  sort?: TableSort;
  onSortChange?: (sort: TableSort) => void;
  /** Adds a check per row. */
  selectable?: boolean;
  /** The checked row ids. */
  selected?: string[];
  onSelectionChange?: (ids: string[]) => void;
  loading?: boolean;
  emptyText?: string;
  density?: 'compact' | 'comfortable';
};

const nextDirection = (sort: TableSort | undefined, column: string): TableSort['direction'] => (sort?.column === column && sort.direction === 'ascending' ? 'descending' : 'ascending');

/** Rows and columns of data with sorting (aria-sort), row checks, and loading and empty states. A native <table>. */
export function Table({ caption, columns, rows, sort, onSortChange, selectable = false, selected = [], onSelectionChange, loading = false, emptyText = 'Nothing to show yet.', density = 'comfortable' }: TableProps) {
  const pad = density === 'compact' ? 'px-3 py-1.5' : 'px-4 py-3';
  const toggle = (id: string) => onSelectionChange?.(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const span = columns.length + (selectable ? 1 : 0);
  return (
    <table aria-busy={loading || undefined} data-density={density} className="w-full border-collapse text-left text-sm text-slate-900">
      <caption className="mb-2 text-left text-base font-semibold">{caption}</caption>
      <thead className="border-b border-slate-200 bg-slate-50">
        <tr>
          <SelectHeader show={selectable} pad={pad} />
          {columns.map((c) => <HeaderCell key={c.key} column={c} sort={sort} pad={pad} onSort={() => onSortChange?.({ column: c.key, direction: nextDirection(sort, c.key) })} />)}
        </tr>
      </thead>
      <tbody>
        <TableNotice show={loading} span={span} pad={pad} text="Loading…" />
        <TableNotice show={!loading && rows.length === 0} span={span} pad={pad} text={emptyText} />
        {rows.map((r) => (
          <tr key={r.id} aria-selected={selectable ? selected.includes(r.id) : undefined} className="border-b border-slate-100 hover:bg-slate-50 aria-selected:bg-slate-100">
            <SelectCell show={selectable} pad={pad} label={`Select ${String(r[columns[0]?.key] ?? r.id)}`} checked={selected.includes(r.id)} onToggle={() => toggle(r.id)} />
            {columns.map((c) => <td key={c.key} className={pad}>{r[c.key]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HeaderCell({ column, sort, pad, onSort }: { column: TableColumn; sort?: TableSort; pad: string; onSort: () => void }) {
  const active = sort?.column === column.key;
  const ariaSort = active ? sort.direction : column.sortable ? 'none' : undefined;
  if (!column.sortable) return <th scope="col" className={`${pad} font-semibold`}>{column.header}</th>;
  return (
    <th scope="col" aria-sort={ariaSort} className={`${pad} font-semibold`}>
      <button type="button" onClick={onSort} data-part="sortButton" className="inline-flex items-center gap-1 rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">
        {column.header}
        <span aria-hidden="true">{active ? (sort.direction === 'ascending' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

function SelectHeader({ show, pad }: { show: boolean; pad: string }) {
  if (!show) return null;
  return <th scope="col" className={pad}><span className="sr-only">Selected</span></th>;
}

function SelectCell({ show, pad, label, checked, onToggle }: { show: boolean; pad: string; label: string; checked: boolean; onToggle: () => void }) {
  if (!show) return null;
  return <td className={pad}><input type="checkbox" aria-label={label} checked={checked} onChange={onToggle} className="h-4 w-4 accent-slate-900" /></td>;
}

function TableNotice({ show, span, pad, text }: { show: boolean; span: number; pad: string; text: string }) {
  if (!show) return null;
  return <tr><td colSpan={span} data-part="empty" className={`${pad} text-center text-slate-500`}>{text}</td></tr>;
}
