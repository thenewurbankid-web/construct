// The commit-on-save session's own small state machine: loading, busy, and the last error. Kept
// out of the hook so the transitions are testable without React, and so the hook stays short
// enough to read in one go.
import type { GitSessionStatus } from '../types';

export type GitSessionState = {
  status: GitSessionStatus | null;
  /** An action is in flight (answering the prompt, committing, changing the config). */
  busy: boolean;
  error: string | null;
};

export type GitSessionAction =
  | { type: 'LOADED'; status: GitSessionStatus }
  | { type: 'LOAD_FAILED'; message: string }
  | { type: 'BUSY' }
  | { type: 'DONE'; message?: string | null };

export const initialGitSessionState: GitSessionState = { status: null, busy: false, error: null };

export function gitSessionReducer(state: GitSessionState, action: GitSessionAction): GitSessionState {
  switch (action.type) {
    // A poll that succeeds clears a previous transport error: the backend is plainly reachable
    // again, and leaving a stale "could not read the git session" next to a live status is worse
    // than saying nothing.
    case 'LOADED': return { ...state, status: action.status, error: null };
    case 'LOAD_FAILED': return { ...state, error: action.message };
    case 'BUSY': return { ...state, busy: true };
    case 'DONE': return { ...state, busy: false, error: action.message ?? null };
    default: return state;
  }
}
