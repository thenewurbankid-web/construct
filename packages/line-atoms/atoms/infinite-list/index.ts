// Atom infinite-list (query.infinite): load more items as the person scrolls.
// Wraps TanStack Query's useInfiniteQuery: pages with their cursors, getNextPageParam (here: the page's nextCursor),
// hasNextPage, fetchNextPage and isFetchingNextPage. Only one load runs at a time and an answer for a cursor that is
// no longer asked for is ignored, so a page is never added twice.
import type { AtomMachine } from '../types.ts';

export type Cursor = string | number | null;

export interface Page<T> { items: T[]; cursor: Cursor; nextCursor: Cursor }

export interface InfiniteState<T> {
  status: 'pending' | 'success' | 'error';
  pages: Page<T>[];
  loading: Cursor | undefined;
  error: unknown;
}

export type InfiniteEvent<T> =
  | { type: 'FETCH_FIRST' }
  | { type: 'FETCH_NEXT' }
  | { type: 'RESOLVE'; cursor: Cursor; items: T[]; nextCursor: Cursor }
  | { type: 'REJECT'; cursor: Cursor; error: unknown }
  | { type: 'RESET' };

/** The cursor of the next page, or null when the last page said there is none. */
export function nextCursor(state: InfiniteState<unknown>): Cursor {
  if (state.pages.length === 0) {
    return null;
  }
  return state.pages[state.pages.length - 1].nextCursor;
}

export function hasNextPage(state: InfiniteState<unknown>): boolean {
  return state.pages.length > 0 && nextCursor(state) !== null;
}

export function isFetchingNextPage(state: InfiniteState<unknown>): boolean {
  return state.loading !== undefined && state.pages.length > 0;
}

/** Every loaded item, page after page. */
export function items<T>(state: InfiniteState<T>): T[] {
  return state.pages.flatMap((p) => p.items);
}

export const machine: AtomMachine<InfiniteState<any>, InfiniteEvent<any>, void> = {
  id: 'infinite-list',
  init() {
    return { status: 'pending', pages: [], loading: undefined, error: null };
  },
  send(state, event) {
    switch (event.type) {
      case 'FETCH_FIRST':
        if (state.loading !== undefined) {
          return state;
        }
        return { status: 'pending', pages: [], loading: null, error: null };
      case 'FETCH_NEXT':
        if (state.loading !== undefined || !hasNextPage(state)) {
          return state;
        }
        return { ...state, loading: nextCursor(state), error: null };
      case 'RESOLVE':
        if (state.loading === undefined || event.cursor !== state.loading) {
          return state;
        }
        return { status: 'success', pages: [...state.pages, { items: event.items, cursor: event.cursor, nextCursor: event.nextCursor }], loading: undefined, error: null };
      case 'REJECT':
        if (state.loading === undefined || event.cursor !== state.loading) {
          return state;
        }
        return { ...state, status: 'error', loading: undefined, error: event.error };
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

/** Load the next page (or the first one) through `load(cursor)` and settle it. */
export async function loadMore<T>(state: InfiniteState<T>, load: (cursor: Cursor) => Promise<{ items: T[]; nextCursor: Cursor }>): Promise<InfiniteState<T>> {
  let asking = machine.send(state, { type: 'FETCH_NEXT' }) as InfiniteState<T>;
  if (state.pages.length === 0) {
    asking = machine.send(state, { type: 'FETCH_FIRST' }) as InfiniteState<T>;
  }
  if (asking === state) {
    return state;
  }
  const cursor = asking.loading as Cursor;
  try {
    const page = await load(cursor);
    return machine.send(asking, { type: 'RESOLVE', cursor, items: page.items, nextCursor: page.nextCursor }) as InfiniteState<T>;
  } catch (error) {
    return machine.send(asking, { type: 'REJECT', cursor, error }) as InfiniteState<T>;
  }
}
