'use client';

import type { ReactNode } from 'react';
import { useProjectGate } from '../hooks/useProjectGate';
import { ProjectGatePage } from '../pages/ProjectGatePage';
import { OpenProjectController } from './OpenProjectController';

/** Wraps a route that needs a valid Construct project (Dashboard, Wizard,
 * Pages Editor) and blocks it behind a project-selection/init screen
 * instead of letting it render against a directory that has no
 * architecture.yml above it. Every gated feature's own controller imports
 * this one from project-gate's public API (index.ts) and wraps its content
 * with it — the real, checked (SLICE-002) cross-feature dependency the
 * migration in #71 asked for.
 *
 * #365: with no project open it shows the "Open a project" screen (OpenProjectController, mounted only then). */
export function ProjectGateController({ children }: { children: ReactNode }) {
  const { status, initializing, error, loadError, opening, openError, refresh, handleInit, handleOpen } = useProjectGate();
  return (
    <ProjectGatePage
      status={status}
      initializing={initializing}
      error={error}
      onInit={handleInit}
      loadError={loadError}
      onRetry={refresh}
      openProject={status ? <OpenProjectController status={status} opening={opening} openError={openError} onOpen={handleOpen} /> : null}
    >
      {children}
    </ProjectGatePage>
  );
}
