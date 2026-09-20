import type { ReactNode } from 'react';
import { CommitIndicator } from '../components/CommitIndicator';
import { DirtyTreePrompt } from '../components/DirtyTreePrompt';
import type { DirtyAnswer, GitSessionView } from '../types';

type GitSessionPageProps = {
  view: GitSessionView;
  busy: boolean;
  onAnswer: (answer: DirtyAnswer, remember: boolean) => void;
  onCommit: () => void;
};

// The save-time surface of commit-on-save: the indicator, and — only when a session started on a
// dirty tree — the question above it. Rendered inside whichever editor is open rather than as a
// route of its own, so you see what the tool is doing to your history where you are working.
export function GitSessionPage({ view, busy, onAnswer, onCommit }: GitSessionPageProps): ReactNode {
  return (
    <>
      {view.prompt && <DirtyTreePrompt prompt={view.prompt} busy={busy} onAnswer={onAnswer} />}
      <CommitIndicator view={view} busy={busy} onCommit={onCommit} />
    </>
  );
}
