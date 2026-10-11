'use client';

import { LinePlanController, useLinePlan } from '@/features/line-plan';
import { LineTraceController } from '@/features/line-trace';
import { PagesEditorController } from '@/features/pages-editor';
import { usePagesScreen } from '../hooks/usePagesScreen';
import { PagesScreenPage } from '../pages/PagesScreenPage';

const NOTHING = () => {};

/** /pages: a Line project gets the Line Pages screen with its Plan panel (every Save is a plan step the person
 * approves); any other project keeps today's Pages editor, untouched. */
export function PagesScreenController() {
  const plan = useLinePlan(NOTHING);
  const { phase, view } = usePagesScreen(plan);
  return (
    <PagesScreenPage
      phase={phase}
      view={view}
      fallback={<PagesEditorController />}
      panel={
        <>
          <LineTraceController screen="pages" steps={plan.steps} />
          <LinePlanController plan={plan} />
        </>
      }
    />
  );
}
