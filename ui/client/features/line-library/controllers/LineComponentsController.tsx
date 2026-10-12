'use client';

import { useCallback, useMemo, useState } from 'react';
import { ComponentsController } from '@/features/component-docs';
import { ComponentEditorArea } from '@/features/line-components';
import { useUrlSelection } from '@/features/list-browser';
import { LineDraftController } from '@/features/line-draft';
import { LinePlanController, useLinePlan } from '@/features/line-plan';
import { LineTraceController } from '@/features/line-trace';
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
  // cu4: the editor re-reads its component after a step landed (revision).
  const [revision, setRevision] = useState(0);
  const onLanded = useCallback(() => {
    refresh();
    revalidate();
    setRevision((r) => r + 1);
  }, [refresh, revalidate]);
  const editing = useUrlSelection('component');
  // cp1: Base on and Promote add a plan step; the Plan panel's Approve runs it, then the project is read again.
  const plan = useLinePlan(onLanded, undefined, screen.kind === 'line');
  const notice = plan.lastRun?.apply ?? null;
  const changes = useLineChanges(features, plan.addStep, notice, onLanded);
  const openEditor = editing.select;
  const controls = useMemo(() => ({ ...changes, openEditor, editing: editing.value }), [changes, openEditor, editing.value]);
  const library = useMemo(() => (screen.kind === 'line' ? screen.view.groups.flatMap((g) => g.cards.filter((c) => !c.readOnly).map((c) => ({ id: c.id, name: c.name }))) : []), [screen]);
  return (
    <LineScreenSwitch
      screen={screen}
      fallback={<ComponentsController />}
      controls={controls}
      editor={<ComponentEditorArea file={editing.value} addStep={plan.addStep} revision={revision} library={library} features={features} />}
      panel={
        <>
          <LineTraceController screen="components" steps={plan.steps} />
          <LineDraftController onAdded={plan.refresh} />
          <LinePlanController plan={plan} />
        </>
      }
    />
  );
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
