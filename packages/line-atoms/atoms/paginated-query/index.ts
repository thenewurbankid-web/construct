// Atom paginated-query (query.paginate): load one page of data at a time from a server.
// Wraps TanStack Query's paginated pattern (placeholderData: keepPreviousData, isPlaceholderData) with TanStack Table's
// pagination state. Moving to another page keeps the previous page on screen, marked as a placeholder, until the new
// one arrives; an answer for a page that is no longer asked for is ignored. Built from the client-pagination atom's
// page arithmetic.
import type { AtomMachine } from '../types.ts';
import { pageCount, clampPage } from '../client-pagination/index.ts';

export type QueryStatus = 'pending' | 'success' | 'error';

export interface PageQueryState<T> {
  status: QueryStatus;
  pageIndex: number;
  pageSize: number;
  items: T[];
  total: number;
  fetching: boolean;
  placeholder: boolean;
  error: unknown;
}

export type PageQueryEvent<T> =
  | { type: 'FETCH' }
  | { type: 'RESOLVE'; pageIndex: number; items: T[]; total: number }
  | { type: 'REJECT'; pageIndex: number; error: unknown }
  | { type: 'NEXT' }
  | { type: 'PREVIOUS' }
  | { type: 'GO_TO'; pageIndex: number }
  | { type: 'SET_PAGE_SIZE'; pageSize: number };

/** The page request a loader needs: TanStack Query's queryKey parts. */
export function pageRequest(state: PageQueryState<unknown>): { pageIndex: number; pageSize: number; offset: number } {
  return { pageIndex: state.pageIndex, pageSize: state.pageSize, offset: state.pageIndex * state.pageSize };
}

export function hasNextPage(state: PageQueryState<unknown>): boolean {
  return state.pageIndex < pageCount(state.total, state.pageSize) - 1;
}

export function hasPreviousPage(state: PageQueryState<unknown>): boolean {
  return state.pageIndex > 0;
}

/** Ask for another page, keeping what is on screen as a placeholder. */
function moveTo<T>(state: PageQueryState<T>, pageIndex: number): PageQueryState<T> {
  if (pageIndex === state.pageIndex) {
    return state;
  }
  const keeps = state.status === 'success';
  return { ...state, pageIndex, fetching: true, placeholder: keeps, error: null };
}

export const machine: AtomMachine<PageQueryState<any>, PageQueryEvent<any>, { pageSize?: number; pageIndex?: number }> = {
  id: 'paginated-query',
  init(input) {
    return { status: 'pending', pageIndex: input?.pageIndex ?? 0, pageSize: input?.pageSize ?? 10, items: [], total: 0, fetching: false, placeholder: false, error: null };
  },
  send(state, event) {
    switch (event.type) {
      case 'FETCH':
        if (state.fetching) {
          return state;
        }
        return { ...state, fetching: true, error: null };
      case 'RESOLVE':
        if (!state.fetching || event.pageIndex !== state.pageIndex) {
          return state;
        }
        return { ...state, status: 'success', items: event.items, total: event.total, pageIndex: clampPage(event.pageIndex, event.total, state.pageSize), fetching: false, placeholder: false, error: null };
      case 'REJECT':
        if (!state.fetching || event.pageIndex !== state.pageIndex) {
          return state;
        }
        return { ...state, status: 'error', error: event.error, fetching: false, placeholder: false };
      case 'NEXT':
        if (!hasNextPage(state)) {
          return state;
        }
        return moveTo(state, state.pageIndex + 1);
      case 'PREVIOUS':
        if (!hasPreviousPage(state)) {
          return state;
        }
        return moveTo(state, state.pageIndex - 1);
      case 'GO_TO':
        return moveTo(state, clampPage(event.pageIndex, state.total, state.pageSize));
      case 'SET_PAGE_SIZE': {
        if (event.pageSize < 1 || event.pageSize === state.pageSize) {
          return state;
        }
        const pageIndex = Math.floor((state.pageIndex * state.pageSize) / event.pageSize);
        return { ...state, pageSize: event.pageSize, pageIndex, fetching: true, placeholder: state.status === 'success', error: null };
      }
      default:
        return state;
    }
  },
  stateOf(state) {
    return state.status;
  },
};

/** Load the page the state asks for and settle it. */
export async function loadPage<T>(state: PageQueryState<T>, load: (req: { pageIndex: number; pageSize: number; offset: number }) => Promise<{ items: T[]; total: number }>): Promise<PageQueryState<T>> {
  const asking = machine.send(state, { type: 'FETCH' }) as PageQueryState<T>;
  const req = pageRequest(asking);
  try {
    const page = await load(req);
    return machine.send(asking, { type: 'RESOLVE', pageIndex: req.pageIndex, items: page.items, total: page.total }) as PageQueryState<T>;
  } catch (error) {
    return machine.send(asking, { type: 'REJECT', pageIndex: req.pageIndex, error }) as PageQueryState<T>;
  }
}
