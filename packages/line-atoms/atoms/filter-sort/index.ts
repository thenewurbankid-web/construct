// Atom filter-sort (list.filterSort): filter, search and sort a list.
// Wraps TanStack Table's columnFilters, globalFilter and sorting ([{id, desc}]) with getFilteredRowModel and
// getSortedRowModel. A filter value of "", "all" or undefined means no filter; the search ignores case and looks in the
// fields it is given; sorting is stable and puts empty values last.
import type { AtomMachine } from '../types.ts';

export type FilterValue = string | number | boolean | undefined;

export interface Sort { id: string; desc: boolean }

export interface View {
  status: 'unfiltered' | 'filtered';
  filters: Record<string, FilterValue>;
  search: string;
  sort: Sort | null;
}

export type ViewEvent =
  | { type: 'SET_FILTER'; id: string; value: FilterValue }
  | { type: 'CLEAR_FILTER'; id: string }
  | { type: 'SET_SEARCH'; text: string }
  | { type: 'SORT_BY'; id: string; desc?: boolean }
  | { type: 'TOGGLE_SORT'; id: string }
  | { type: 'RESET' };

/** Whether a filter value means "no filter". */
export function isNoFilter(value: FilterValue): boolean {
  return value === undefined || value === '' || value === 'all';
}

function statusOf(filters: Record<string, FilterValue>, search: string): View['status'] {
  const active = Object.values(filters).some((v) => !isNoFilter(v));
  if (active || search.trim() !== '') {
    return 'filtered';
  }
  return 'unfiltered';
}

function view(filters: Record<string, FilterValue>, search: string, sort: Sort | null): View {
  return { status: statusOf(filters, search), filters, search, sort };
}

/** Whether a cell is empty (sorted last either way). */
export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/** Compare two cell values: numbers and dates by value, text ignoring case, empty values last. */
export function compareValues(a: unknown, b: unknown): number {
  const emptyA = isEmptyValue(a);
  const emptyB = isEmptyValue(b);
  if (emptyA && emptyB) {
    return 0;
  }
  if (emptyA) {
    return 1;
  }
  if (emptyB) {
    return -1;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

/** Whether a row's search fields contain the text, ignoring case. */
export function matchesSearch<T>(row: T, text: string, fields: (keyof T)[]): boolean {
  const needle = text.trim().toLowerCase();
  if (needle === '') {
    return true;
  }
  return fields.some((f) => String(row[f] ?? '').toLowerCase().includes(needle));
}

/** The rows the view shows: filtered by every active filter and the search, then sorted. */
export function applyView<T extends Record<string, unknown>>(rows: T[], v: View, searchFields: (keyof T)[] = []): T[] {
  const active = Object.entries(v.filters).filter(([, value]) => !isNoFilter(value));
  const kept = rows.filter((row) => active.every(([id, value]) => row[id] === value) && matchesSearch(row, v.search, searchFields));
  if (v.sort === null) {
    return kept;
  }
  const { id, desc } = v.sort;
  const indexed = kept.map((row, i) => ({ row, i }));
  indexed.sort((x, y) => {
    const c = compareValues(x.row[id], y.row[id]);
    if (c === 0) {
      return x.i - y.i;
    }
    if (desc && !isEmptyValue(x.row[id]) && !isEmptyValue(y.row[id])) {
      return -c;
    }
    return c;
  });
  return indexed.map((x) => x.row);
}

export const machine: AtomMachine<View, ViewEvent, { filters?: Record<string, FilterValue>; search?: string; sort?: Sort | null } | void> = {
  id: 'filter-sort',
  init(input) {
    return view({ ...(input?.filters ?? {}) }, input?.search ?? '', input?.sort ?? null);
  },
  send(state, event) {
    switch (event.type) {
      case 'SET_FILTER':
        if (state.filters[event.id] === event.value) {
          return state;
        }
        return view({ ...state.filters, [event.id]: event.value }, state.search, state.sort);
      case 'CLEAR_FILTER': {
        if (!(event.id in state.filters)) {
          return state;
        }
        const filters = { ...state.filters };
        delete filters[event.id];
        return view(filters, state.search, state.sort);
      }
      case 'SET_SEARCH':
        if (event.text === state.search) {
          return state;
        }
        return view(state.filters, event.text, state.sort);
      case 'SORT_BY':
        return view(state.filters, state.search, { id: event.id, desc: event.desc ?? false });
      case 'TOGGLE_SORT': {
        // none -> ascending -> descending -> none, the way a column header cycles.
        if (state.sort === null || state.sort.id !== event.id) {
          return view(state.filters, state.search, { id: event.id, desc: false });
        }
        if (!state.sort.desc) {
          return view(state.filters, state.search, { id: event.id, desc: true });
        }
        return view(state.filters, state.search, null);
      }
      case 'RESET':
        return machine.init();
      default:
        return state;
    }
  },
  stateOf(state) {
    return state.status;
  },
};

/** One call: filter, search and sort `rows`. */
export function filterSort<T extends Record<string, unknown>>(rows: T[], options: { filters?: Record<string, FilterValue>; search?: string; searchFields?: (keyof T)[]; sort?: Sort | null }): T[] {
  return applyView(rows, machine.init({ filters: options.filters, search: options.search, sort: options.sort }), options.searchFields ?? []);
}
