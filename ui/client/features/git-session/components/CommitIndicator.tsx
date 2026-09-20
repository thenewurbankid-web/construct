'use client';

import { Badge, Button } from '@/components/ui';
import type { GitSessionView, SaveStateKind } from '../types';

type CommitIndicatorProps = {
  view: GitSessionView;
  busy: boolean;
  onCommit: () => void;
};

const TONE: Record<SaveStateKind, 'tool' | 'llm' | 'llm-none' | 'error'> = {
  off: 'llm-none',
  'no-repo': 'llm-none',
  idle: 'tool',
  pending: 'llm',
  asking: 'error',
  committed: 'tool',
};

// A tool that writes to your git history must never be ambiguous about whether it is armed, what
// it is about to do, or what it just did. One line, always present: state, then the last commit's
// real subject and counted impact. Everything shown here is already formatted by the domain layer.
export function CommitIndicator({ view, busy, onCommit }: CommitIndicatorProps) {
  const { state, lastCommit } = view;

  return (
    <section className="git-indicator" data-testid="commit-indicator" data-state={state.kind} role="status">
      <div className="git-indicator__row">
        <Badge tone={TONE[state.kind]}>{state.kind}</Badge>
        <span className="git-indicator__text" data-testid="commit-indicator-text">
          {state.text}
        </span>
        {view.canCommit && (
          <Button type="button" variant="ghost" disabled={busy} onClick={onCommit} data-testid="commit-now">
            Commit now
          </Button>
        )}
      </div>

      {lastCommit && (
        <dl className="git-indicator__commit" data-testid="last-commit">
          <dt>Message</dt>
          <dd>
            <code data-testid="last-commit-subject">{lastCommit.subject}</code>
          </dd>
          <dt>Impact</dt>
          <dd data-testid="last-commit-impact">
            {lastCommit.impactText}
            {lastCommit.perFeatureText ? ` — ${lastCommit.perFeatureText}` : ''}
          </dd>
          <dt>Branch</dt>
          <dd>
            <code data-testid="last-commit-branch">{lastCommit.branch}</code>
          </dd>
        </dl>
      )}

      {view.stash && (
        <p className="hint" data-testid="stash-note">
          Your earlier changes are in <code>{view.stash}</code>.
        </p>
      )}
    </section>
  );
}
