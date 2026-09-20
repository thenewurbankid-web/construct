'use client';

import type { ReactNode } from 'react';
import { Button, GlassPanel } from '@/components/ui';

type NoProjectScreenProps = {
  /** The one folder the server will ever open projects from. */
  workspaceRoot: string | null;
  /** The previously open project (a real folder in the workspace), offered but never opened automatically. */
  lastProject: string | null;
  opening: boolean;
  error: string | null;
  onOpen: (dir: string) => void;
  /** The workspace-scoped folder picker (another feature's controller, composed by the controller). */
  picker: ReactNode;
  /** The clone-a-repository form (another feature's controller, composed by the controller). */
  clone?: ReactNode;
};

const nameOf = (dir: string) => dir.split(/[\\/]+/).filter(Boolean).pop() ?? dir;

/** Presentation-only "Open a project" screen (#365): the Cockpit starts with nothing open and never loads the
 * directory it was launched from. One prompt, one picker, scoped to the workspace. */
export function NoProjectScreen({ workspaceRoot, lastProject, opening, error, onOpen, picker, clone }: NoProjectScreenProps) {
  return (
    <div className="page page--screen">
      <GlassPanel className="gate-panel no-project" data-testid="no-project">
        <h1>Open a project</h1>
        <p className="hint">
          No project is open. Choose a folder from the workspace to work on — the Cockpit only opens projects
          that live inside it, and cannot browse anywhere else.
        </p>
        {lastProject && (
          <div className="no-project__reopen">
            <Button type="button" onClick={() => onOpen(lastProject)} disabled={opening} data-testid="reopen-project">
              Reopen {nameOf(lastProject)}
            </Button>
            <span className="hint">Last project you had open.</span>
          </div>
        )}
        {error && (
          <p className="status-error" role="alert">
            {error}
          </p>
        )}
        {picker}
        {clone}
        <p className="hint no-project__hint">
          Don&apos;t see your project? Put it in the workspace first
          {workspaceRoot ? (
            <>
              , for example <code>git clone &lt;repository-url&gt; {workspaceRoot}/my-project</code>
            </>
          ) : (
            ', for example with git clone'
          )}
          , then pick it here.
        </p>
      </GlassPanel>
    </div>
  );
}
