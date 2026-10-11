'use client';

import { useCallback, useMemo } from 'react';
import { ComponentsController } from '@/features/component-docs';
import { ProjectGateController } from '@/features/project-gate';
import { useShellDrawer } from '@/features/shell';
import { useLineWorkspace } from '@/lib/lineWorkspace';
import '../components/line-library.css';
import { LineScreenSwitch } from '../components/LineScreenSwitch';
import { screenFor } from '../domain/LibraryView';
import { screenWithWorkspace, writableFeatures } from '../domain/ReadOnly';
import { useLineChanges } from '../hooks/useLineChanges';
import { useLineProject } from '../hooks/useLineProject';

const NO_FEATURES: string[] = [];

function LineComponentsScreen() {
  const { state, refresh } = useLineProject();
  const { revalidate } = useShellDrawer();
  const { folder } = useLineWorkspace();
  const screen = useMemo(() => screenWithWorkspace(screenFor(state), folder), [state, folder]);
  // Only features inside the workspace folder are offered to "Base on this" (the rest are read-only).
  const features = useMemo(() => (screen.kind === 'line' ? writableFeatures(screen.view, folder) : NO_FEATURES), [screen, folder]);
  // After a change landed: read the project again (counts, rows) and re-run validate (Diagnostics, status bar).
  const onLanded = useCallback(() => {
    refresh();
    revalidate();
  }, [refresh, revalidate]);
  const controls = useLineChanges(features, onLanded);
  return <LineScreenSwitch screen={screen} fallback={<ComponentsController />} controls={controls} />;
}

/** The Components screen (`/components`): a `preset: line` project gets its library as cards by level ("Base on
 * this") plus each feature's components with their base links ("Promote to library"); any other project, or a Line
 * view that could not be read, gets the existing Components screen unchanged. */
export function LineComponentsController() {
  return (
    <ProjectGateController>
      <LineComponentsScreen />
    </ProjectGateController>
  );
}
