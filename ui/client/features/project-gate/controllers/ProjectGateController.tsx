'use client';

import type { ReactNode } from 'react';
import { CloneController } from '@/features/clone';
import { DirectoryBrowserController, useWorkspaceFolder } from '@/features/directory-browser';
import { useProjectGate } from '../hooks/useProjectGate';
import { ProjectGatePage } from '../pages/ProjectGatePage';

/** The folder that gets the one-click "Try the sample shop" shortcut on the Open-a-project screen. */
const SAMPLE_FOLDER = 'shop';

/** Wraps a route that needs a valid Construct project (Dashboard, Wizard,
 * Pages Editor) and blocks it behind a project-selection/init screen
 * instead of letting it render against a directory that has no
 * architecture.yml above it. Every gated feature's own controller imports
 * this one from project-gate's public API (index.ts) and wraps its content
 * with it — the real, checked (SLICE-002) cross-feature dependency the
 * migration in #71 asked for.
 *
 * #365: with no project open it shows the "Open a project" screen; the folder picker is another feature's
 * controller (directory-browser), composed here as a slot, scoped by the server to the workspace. */
export function ProjectGateController({ children }: { children: ReactNode }) {
  const sample = useWorkspaceFolder(SAMPLE_FOLDER);
  const { status, initializing, error, loadError, opening, openError, refresh, handleInit, handleOpen } = useProjectGate();
  return (
    <ProjectGatePage
      status={status}
      initializing={initializing}
      error={error}
      onInit={handleInit}
      loadError={loadError}
      onRetry={refresh}
      opening={opening}
      openError={openError}
      onOpen={handleOpen}
      picker={<DirectoryBrowserController onSelect={handleOpen} />}
      samplePath={sample.state === 'found' ? sample.path : null}
      sampleLoading={sample.state === 'loading'}
      clone={<CloneController onCloned={handleOpen} workspaceRoot={status?.workspaceRoot ?? null} />}
    >
      {children}
    </ProjectGatePage>
  );
}
