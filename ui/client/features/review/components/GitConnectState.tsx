import type { ReactNode } from 'react';

type GitConnectStateProps = {
  /** Which of the two forms is revealed below the buttons, or neither. */
  open: 'connect' | 'clone' | null;
  onToggle: (which: 'connect' | 'clone') => void;
  /** #330 slice A, reused exactly as built for Settings / the Open-a-project screen -- only the
   * position of these two entry points is new here. */
  connect: ReactNode;
  clone: ReactNode;
};

/**
 * The Git screen's empty state when the open project has no remote (mock `ia-git-connect.html`):
 * PRs (and, later, pushing) need a remote; local branches can still be reviewed and committed to
 * without one. Cloning always goes into the single workspace root, same as the Open-a-project
 * screen's own Clone form (#330 slice A) -- reused here, not rebuilt.
 */
export function GitConnectState({ open, onToggle, connect, clone }: GitConnectStateProps) {
  return (
    <div className="dg-empty rv-connect" data-testid="git-connect-state">
      <p className="dg-empty-title">This project has no remote yet</p>
      <p className="hint">
        Connect a GitHub repository to see pull requests, branches and reviews here. Local changes can still be
        reviewed and committed without a remote. Cloning always goes into your single workspace root.
      </p>
      <div className="rv-connect-actions">
        <button type="button" className="dg-btn dg-btn--primary" aria-expanded={open === 'connect'} data-testid="git-connect-remote" onClick={() => onToggle('connect')}>
          Connect remote...
        </button>
        <button type="button" className="dg-btn" aria-expanded={open === 'clone'} data-testid="git-clone-repo" onClick={() => onToggle('clone')}>
          Clone a repository...
        </button>
      </div>
      {open === 'connect' && <div className="rv-connect-panel">{connect}</div>}
      {open === 'clone' && <div className="rv-connect-panel">{clone}</div>}
    </div>
  );
}
