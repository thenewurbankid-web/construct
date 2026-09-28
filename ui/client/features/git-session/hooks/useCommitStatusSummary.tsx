'use client';

import { useGitSession } from './useGitSession';
import { buildGitSessionView } from '../domain/GitSessionView';
import type { SaveState } from '../types';

/**
 * A short summary of the commit-on-save state, for the shell's status bar (#374: "the status-bar
 * commit indicator links to Git > Commits"). Polls via the same `useGitSession` the full indicator
 * and settings already use -- no new polling loop, no new formatting rule, same `SaveState` the
 * Commit tab's own `CommitIndicator` shows in full.
 */
export function useCommitStatusSummary(): SaveState {
  const { status } = useGitSession();
  return buildGitSessionView(status).state;
}
