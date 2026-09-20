'use client';

import { useGitSession } from '../hooks/useGitSession';
import { buildGitSessionView } from '../domain/GitSessionView';
import { GitSessionPage } from '../pages/GitSessionPage';

// Wires the session hook to the save-time surface. Composed as a slot by the editors (Pages,
// Workflows), so neither of them has to know anything about git.
export function CommitIndicatorController() {
  const { status, busy, answer, commit } = useGitSession();
  return <GitSessionPage view={buildGitSessionView(status)} busy={busy} onAnswer={answer} onCommit={commit} />;
}
