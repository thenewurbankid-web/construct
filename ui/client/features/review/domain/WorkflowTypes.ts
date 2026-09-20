// State-machine shapes for the Review screens (list and one change). Re-exported from types.ts.
import type { BranchList, ChangeResponse, ListOrder } from '../types.ts';

// ---- state machine -------------------------------------------------------------

export type ListState = {
  loaded: boolean;
  error: string | null;
  errorCode: string | null;
  data: BranchList | null;
  order: ListOrder;
};
export type ListAction =
  | { type: 'LOADED'; data: BranchList }
  | { type: 'FAILED'; error: string; code?: string | null }
  | { type: 'ORDER'; order: ListOrder };

export type ChangeViewState = {
  status: 'loading' | 'waiting' | 'ready' | 'failed';
  data: ChangeResponse | null;
  error: string | null;
  errorCode: string | null;
  selectedPath: string | null;
  selectedFindingId: string | null;
  grouping: 'feature' | 'layer' | 'files';
};
export type ChangeAction =
  | { type: 'RESET' }
  | { type: 'RESPONSE'; data: ChangeResponse }
  | { type: 'FAILED'; error: string; code?: string | null }
  | { type: 'SELECT'; path: string | null }
  | { type: 'SELECT_FINDING'; id: string | null }
  | { type: 'GROUPING'; grouping: ChangeViewState['grouping'] };
