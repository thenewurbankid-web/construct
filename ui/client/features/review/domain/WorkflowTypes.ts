// State-machine shapes for the Review screens (list and one change). Re-exported from types.ts.
import type { BranchList, ChangeResponse } from '../types.ts';

// ---- state machine -------------------------------------------------------------

/** The branch list's load: one status at a time (#592). The ranking order is independent of it and lives beside it. */
export type ListState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string; errorCode: string | null }
  | { status: 'ready'; data: BranchList };
export type ListAction =
  | { type: 'STARTED' }
  | { type: 'LOADED'; data: BranchList }
  | { type: 'FAILED'; error: string; code?: string | null };

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
