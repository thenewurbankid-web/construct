'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import type { DirtyAnswer, GitSessionView } from '../types';

type DirtyTreePromptProps = {
  prompt: NonNullable<GitSessionView['prompt']>;
  busy: boolean;
  onAnswer: (answer: DirtyAnswer, remember: boolean) => void;
};

// #283: "Ask each time." The failure mode of asking each time is a startup modal that gets
// dismissed unread, so this one SHOWS WHAT IT FOUND — the changed files grouped by feature and
// layer, from the same impact computation the commit messages use. Silently absorbing someone
// else's uncommitted work into a session branch is not recoverable by them if they never noticed.
export function DirtyTreePrompt({ prompt, busy, onAnswer }: DirtyTreePromptProps) {
  const [remember, setRemember] = useState(false);

  return (
    <section className="git-dirty" role="alertdialog" aria-labelledby="git-dirty-title" data-testid="dirty-tree-prompt">
      <h2 id="git-dirty-title">You already had uncommitted changes</h2>
      <p className="git-dirty__question" data-testid="dirty-question">
        {prompt.question}
      </p>

      <ul className="git-dirty__groups" data-testid="dirty-groups">
        {prompt.groupLines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <details className="git-dirty__files">
        <summary>{prompt.count} file(s)</summary>
        <ul>
          {prompt.files.map((f) => (
            <li key={f}>
              <code>{f}</code>
            </li>
          ))}
        </ul>
      </details>

      <label className="git-dirty__remember">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="dirty-remember" />
        <span>Remember my answer for this project</span>
      </label>

      <div className="git-dirty__actions">
        <Button type="button" variant="primary" disabled={busy} onClick={() => onAnswer('carry', remember)} data-testid="dirty-carry">
          Carry onto this session
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => onAnswer('stash', remember)} data-testid="dirty-stash">
          Stash them
        </Button>
      </div>
      <p className="hint">
        Carrying commits them alongside this session&apos;s first commit, marked as pre-existing so
        the impact counts stay honest. Stashing puts them in <code>git stash</code>, and the
        indicator then tells you exactly which entry.
      </p>
    </section>
  );
}
