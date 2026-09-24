'use client';

import type { ReactNode } from 'react';
import { Button, GlassPanel } from '@/components/ui';

type NoProjectScreenProps = {
  /** The one folder the server will ever open projects from (named in the one-sentence hint). */
  workspaceRoot: string | null;
  /** The previously open project (a real folder in the workspace), offered but never opened automatically. */
  lastProject: string | null;
  opening: boolean;
  error: string | null;
  onOpen: (dir: string) => void;
  /** The "Your projects" list (another feature's controller, composed by the controller). */
  picker: ReactNode;
  /** The New project form (another feature's controller, composed by the controller). */
  newProject?: ReactNode;
  /** The clone-a-repository form (another feature's controller, composed by the controller). */
  clone?: ReactNode;
  /** The workspace's `shop` sample folder, when there is one: offered as a one-click open (same open path as the picker). */
  samplePath?: string | null;
  sampleLoading?: boolean;
};

const nameOf = (dir: string) => dir.split(/[\\/]+/).filter(Boolean).pop() ?? dir;

/** Presentation-only "Open a project" screen (#365): the Cockpit starts with nothing open and never loads the
 * directory it was launched from. One prompt, one picker, scoped to the workspace. */
export function NoProjectScreen({ workspaceRoot, lastProject, opening, error, onOpen, picker, newProject, clone, samplePath = null }: NoProjectScreenProps) {
  return (
    <div className="page page--screen">
      <GlassPanel className="gate-panel no-project" data-testid="no-project">
        <h1>Open a project</h1>
        <p className="hint">
          Pick a project{workspaceRoot ? <> in <code>{workspaceRoot}</code></> : null}, or start a new one.
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
        {samplePath ? (
          <div className="no-project__sample" data-testid="sample-shop">
            <Button type="button" onClick={() => onOpen(samplePath)} disabled={opening} data-testid="open-sample-shop">
              Try the sample shop
            </Button>
            <span className="hint">A small demo app already in your workspace. Opens like any other project.</span>
          </div>
        ) : null}
        {newProject}
        {clone}
        {picker}
      </GlassPanel>
    </div>
  );
}
