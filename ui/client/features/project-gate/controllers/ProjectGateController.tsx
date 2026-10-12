'use client';

import type { ReactNode } from 'react';
import { ScreenModesController } from '@/features/line-modes';
import { useWorkspaceFolder } from '@/features/directory-browser';
import { useOpenModes } from '../hooks/useOpenModes';
import { useProjectGate } from '../hooks/useProjectGate';
import { OPEN_MODES } from '../domain/OpenModes';
import { ProjectGatePage } from '../pages/ProjectGatePage';
import { OpenProjectController } from './OpenProjectController';

/** The folder that gets the one-click "Try the sample shop" shortcut (the chat's sample option; the screen has its own). */
const SAMPLE_FOLDER = 'shop';

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
  const sample = useWorkspaceFolder(SAMPLE_FOLDER);
  const { status, initializing, error, loadError, opening, openError, refresh, handleInit, handleOpen } = useProjectGate();
  const samplePath = sample.state === 'found' ? sample.path : null;
  const modes = useOpenModes(status?.workspaceRoot ?? null, status?.lastProject ?? null, samplePath, handleOpen);
  const frameNoProject = (screen: ReactNode) => <ScreenModesController provider={OPEN_MODES} data={modes.data} hood={screen} onOption={modes.onOption} />;
  return (
    <ProjectGatePage
      status={status}
      initializing={initializing}
      error={error}
      onInit={handleInit}
      loadError={loadError}
      onRetry={refresh}
      frameNoProject={frameNoProject}
      openProject={status ? <OpenProjectController status={status} opening={opening} openError={openError} onOpen={handleOpen} /> : null}
    >
      {children}
    </ProjectGatePage>
  );
}
