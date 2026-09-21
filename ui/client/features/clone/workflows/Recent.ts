import type { PullResult, RecentClone } from '../types';

// Workflows own application state/flow but never import React (WORKFLOW-001): plain reducers.
/** The recent clones of this browser, and what "Pull latest" last said for each folder. */
export type RecentState = {
  items: RecentClone[];
  /** Folder name -> what the last update said (or that one is running). */
  pulls: Record<string, { busy: boolean; result: PullResult | null }>;
};

export type RecentAction =
  | { type: 'SET'; items: RecentClone[] }
  | { type: 'PULL_START'; name: string }
  | { type: 'PULL_DONE'; name: string; result: PullResult };

export const initialRecentState: RecentState = { items: [], pulls: {} };

export function recentReducer(state: RecentState, action: RecentAction): RecentState {
  switch (action.type) {
    case 'SET':
      return { ...state, items: action.items };
    case 'PULL_START':
      return { ...state, pulls: { ...state.pulls, [action.name]: { busy: true, result: null } } };
    case 'PULL_DONE':
      return { ...state, pulls: { ...state.pulls, [action.name]: { busy: false, result: action.result } } };
    default:
      return state;
  }
}
