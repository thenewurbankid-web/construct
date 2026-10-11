'use client';

import { useCallback, useMemo } from 'react';
import { ComponentsController } from '@/features/component-docs';
import { LinePlanController, useLinePlan } from '@/features/line-plan';
import { ProjectGateController } from '@/features/project-gate';
import { useShellDrawer } from '@/features/shell';
import { useLineWorkspace } from '@/lib/lineWorkspace';
import '../components/line-library.css';
import { LineScreenSwitch } from '../components/LineScreenSwitch';
import { screenFor } from '../domain/LibraryView';
import { screenWithWorkspace } from '../domain/ReadOnly';
import { useLineChanges } from '../hooks/useLineChanges';
import { useLineProject } from '../hooks/useLineProject';

const NO_FEATURES: string[] = [];

function LineComponentsScreen() {
  const { state, refresh } = useLineProject();
  const { revalidate } = useShellDrawer();
  const { folder } = useLineWorkspace();
  const screen = useMemo(() => screenWithWorkspace(screenFor(state), folder), [state, folder]);
  const features = screen.kind === 'line' ? screen.view.featureNames : NO_FEATURES;
  // After a change landed: read the project again (counts, rows) and re-run validate (Diagnostics, status bar).
  const onLanded = useCallback(() => {
    refresh();
    revalidate();
  }, [refresh, revalidate]);
  // cp1: Base on and Promote add a plan step; the Plan panel's Approve runs it, then the project is read again.
  const plan = useLinePlan(onLanded);
  const notice = plan.lastRun?.apply ?? null;
  const controls = useLineChanges(features, plan.addStep, notice);
  return <LineScreenSwitch screen={screen} fallback={<ComponentsController />} controls={controls} panel={<LinePlanController plan={plan} />} />;
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
