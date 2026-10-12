'use client';

import { useCallback, useMemo, type ReactNode } from 'react';
import { ComponentsController } from '@/features/component-docs';
import { LineDraftController } from '@/features/line-draft';
import { ScreenModesController } from '@/features/line-modes';
import { LinePlanController, useLinePlan, withPlanOptions } from '@/features/line-plan';
import { LineTraceController } from '@/features/line-trace';
import { ProjectGateController } from '@/features/project-gate';
import { useShellDrawer } from '@/features/shell';
import { useLineWorkspace } from '@/lib/lineWorkspace';
import '../components/line-library.css';
import { LineScreenSwitch } from '../components/LineScreenSwitch';
import { COMPONENTS_CHAT } from '../domain/ComponentsChat';
import { screenFor } from '../domain/LibraryView';
import { screenWithWorkspace, writableFeatures } from '../domain/ReadOnly';
import { useComponentSelection } from '../hooks/useComponentSelection';
import { useComponentsChatOptions } from '../hooks/useComponentsChatOptions';
import { useLineChanges } from '../hooks/useLineChanges';
import { useLineProject } from '../hooks/useLineProject';
import { LineLibraryPage } from '../pages/LineLibraryPage';
import type { ChangeControls, LibraryView } from '../types';

const NO_FEATURES: string[] = [];
/** Two modes: the Components chat with the Plan's options joined ("components.plan.*"). */
const COMPONENTS_MODES = withPlanOptions(COMPONENTS_CHAT);

/** Under the hood: the Line library, with the feature and component the URL selects (where the chat or a crumb is). */
function LineLibraryHood({ view, controls, panel }: { view: LibraryView; controls: ChangeControls; panel: ReactNode }) {
  const selected = useComponentSelection();
  return <LineLibraryPage view={view} controls={controls} panel={panel} selected={selected} />;
}

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
  // cp1: Base on and Promote add a plan step; the Plan panel's Approve runs it, then the project is read again.
  const plan = useLinePlan(onLanded, undefined, screen.kind === 'line');
  const notice = plan.lastRun?.apply ?? null;
  const controls = useLineChanges(features, plan.addStep, notice, onLanded);
  const view = screen.kind === 'line' ? screen.view : null;
  const data = useMemo(() => (view ? { screen: view, plan: plan.rows } : null), [view, plan.rows]);
  // Options the chat does not answer: the Plan's decisions, and Promote (opens the same confirm as the button).
  const onOption = useComponentsChatOptions(view, plan, controls.openPromote);
  const panel = (
    <>
      <LineTraceController screen="components" steps={plan.steps} />
      <LineDraftController onAdded={plan.refresh} />
      <LinePlanController plan={plan} />
    </>
  );
  const line = view ? <ScreenModesController provider={COMPONENTS_MODES} data={data} onOption={onOption} hood={<LineLibraryHood view={view} controls={controls} panel={panel} />} /> : null;
  return <LineScreenSwitch screen={screen} fallback={<ComponentsController />} line={line} />;
}

/** The Components screen (`/components`): a `preset: line` project gets its library as cards by level ("Base on
 * this") plus each feature's components with their base links ("Promote to library"), in two modes (Chat and Under the
 * hood); any other project, or a Line view that could not be read, gets the existing Components screen unchanged. */
export function LineComponentsController() {
  return (
    <ProjectGateController>
      <LineComponentsScreen />
    </ProjectGateController>
  );
}
