'use client';

import { useMemo, type ReactNode } from 'react';
import { LineDraftController } from '@/features/line-draft';
import { ScreenModesController } from '@/features/line-modes';
import { LinePlanController, useLinePlan, usePlanChatOptions, withPlanOptions } from '@/features/line-plan';
import { LineTraceController } from '@/features/line-trace';
import { PagesEditorController } from '@/features/pages-editor';
import { PAGES_CHAT } from '../domain/PagesChat';
import { useLineProject } from '../hooks/useLineProject';
import { usePagesScreen } from '../hooks/usePagesScreen';
import { PagesHoodPage } from '../pages/PagesHoodPage';
import { PagesScreenPage } from '../pages/PagesScreenPage';
import type { LinePagesApi, LinePagesPlan, LineProject } from '../types';

const NOTHING = () => {};
/** Two modes: the Pages chat with the Plan's options joined ("pages.plan.*"). */
const PAGES_MODES = withPlanOptions(PAGES_CHAT);

type HoodProps = { project: LineProject; api: LinePagesApi; reload: () => Promise<void>; plan: LinePagesPlan; panel: ReactNode };

/** Under the hood: the Line Pages screen. It reads ?feature= and ?page= on mount, so it opens where the chat is. */
function LinePagesHood({ project, api, reload, plan, panel }: HoodProps) {
  const { ready, view } = usePagesScreen(project, api, reload, plan);
  return <PagesHoodPage ready={ready} view={view} panel={panel} />;
}

/** /pages: a Line project gets the Line Pages screen in its two modes (Chat and Under the hood) with its Plan panel
 * (every Save is a plan step the person approves); any other project keeps today's Pages editor, untouched. */
export function PagesScreenController() {
  const { state, reload } = useLineProject();
  const line = state.phase === 'line' ? state : null;
  // The Plan panel asks for the plan only once the project is known to be a Line project.
  const plan = useLinePlan(NOTHING, undefined, line !== null);
  const data = useMemo(() => (line ? { screen: line.project, plan: plan.rows } : null), [line, plan.rows]);
  const onOption = usePlanChatOptions('pages', plan);
  const panel = (
    <>
      <LineTraceController screen="pages" steps={plan.steps} />
      <LineDraftController onAdded={plan.refresh} />
      <LinePlanController plan={plan} />
    </>
  );
  const modes = line ? <ScreenModesController provider={PAGES_MODES} data={data} onOption={onOption} hood={<LinePagesHood project={line.project} api={line.api} reload={reload} plan={plan} panel={panel} />} /> : null;
  return <PagesScreenPage phase={state.phase} line={modes} fallback={<PagesEditorController />} />;
}
