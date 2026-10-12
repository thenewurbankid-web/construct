// Atom client-pagination (list.paginate): split a list into pages and move between them.
// Wraps TanStack Table's pagination state ({pageIndex, pageSize}), getPageCount, getCanNextPage and
// getCanPreviousPage. The page index is always kept inside the pages that exist, so a shrinking list never shows an
// empty page.
import type { AtomMachine } from '../types.ts';

export type PagePosition = 'empty' | 'only' | 'first' | 'middle' | 'last';

export interface PageState {
  status: PagePosition;
  pageIndex: number;
  pageSize: number;
  total: number;
}

export type PageEvent =
  | { type: 'NEXT' }
  | { type: 'PREVIOUS' }
  | { type: 'GO_TO'; pageIndex: number }
  | { type: 'SET_PAGE_SIZE'; pageSize: number }
  | { type: 'SET_TOTAL'; total: number };

/** How many pages `total` rows fill (at least one, so an empty list still has its one empty page). */
export function pageCount(total: number, pageSize: number): number {
  if (total <= 0) {
    return 1;
  }
  return Math.ceil(total / pageSize);
}

/** The page index kept inside 0 .. pageCount - 1. */
export function clampPage(pageIndex: number, total: number, pageSize: number): number {
  const last = pageCount(total, pageSize) - 1;
  if (pageIndex < 0) {
    return 0;
  }
  if (pageIndex > last) {
    return last;
  }
  return Math.floor(pageIndex);
}

/** Where a page index stands among the pages. */
export function positionOf(pageIndex: number, total: number, pageSize: number): PagePosition {
  const count = pageCount(total, pageSize);
  if (total <= 0) {
    return 'empty';
  }
  if (count === 1) {
    return 'only';
  }
  if (pageIndex === 0) {
    return 'first';
  }
  if (pageIndex === count - 1) {
    return 'last';
  }
  return 'middle';
}

function at(pageIndex: number, total: number, pageSize: number): PageState {
  const index = clampPage(pageIndex, total, pageSize);
  return { status: positionOf(index, total, pageSize), pageIndex: index, pageSize, total };
}

/** The rows of the current page: [start, end) into the full list. */
export function sliceBounds(state: PageState): { start: number; end: number } {
  const start = state.pageIndex * state.pageSize;
  return { start, end: Math.min(start + state.pageSize, state.total) };
}

/** The current page's rows. */
export function pageItems<T>(rows: T[], state: PageState): T[] {
  const { start, end } = sliceBounds(state);
  return rows.slice(start, end);
}

export function canNext(state: PageState): boolean {
  return state.status === 'first' || state.status === 'middle';
}

export function canPrevious(state: PageState): boolean {
  return state.status === 'middle' || state.status === 'last';
}

export const machine: AtomMachine<PageState, PageEvent, { total: number; pageSize?: number; pageIndex?: number }> = {
  id: 'client-pagination',
  init(input) {
    return at(input.pageIndex ?? 0, input.total, input.pageSize ?? 10);
  },
  send(state, event) {
    switch (event.type) {
      case 'NEXT':
        if (!canNext(state)) {
          return state;
        }
        return at(state.pageIndex + 1, state.total, state.pageSize);
      case 'PREVIOUS':
        if (!canPrevious(state)) {
          return state;
        }
        return at(state.pageIndex - 1, state.total, state.pageSize);
      case 'GO_TO': {
        const next = at(event.pageIndex, state.total, state.pageSize);
        if (next.pageIndex === state.pageIndex) {
          return state;
        }
        return next;
      }
      case 'SET_PAGE_SIZE': {
        if (event.pageSize < 1) {
          return state;
        }
        // Keep the first row of the current page on screen.
        const firstRow = state.pageIndex * state.pageSize;
        return at(Math.floor(firstRow / event.pageSize), state.total, event.pageSize);
      }
      case 'SET_TOTAL':
        return at(state.pageIndex, event.total, state.pageSize);
      default:
        return state;
    }
  },
  stateOf(state) {
    return state.status;
  },
};

/** One call: the rows of page `pageIndex` of `rows`, with the page facts. */
export function paginate<T>(rows: T[], pageIndex: number, pageSize: number): { items: T[]; pageIndex: number; pageCount: number; canNext: boolean; canPrevious: boolean } {
  const state = machine.init({ total: rows.length, pageSize, pageIndex });
  return { items: pageItems(rows, state), pageIndex: state.pageIndex, pageCount: pageCount(rows.length, pageSize), canNext: canNext(state), canPrevious: canPrevious(state) };
}
