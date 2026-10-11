'use client';

import { useEffect, useState } from 'react';
import { LineDraftController } from '@/features/line-draft';
import { LinePlanController, useLinePlan } from '@/features/line-plan';
import { LineTraceController } from '@/features/line-trace';
import { PagesEditorController } from '@/features/pages-editor';
import { usePagesScreen } from '../hooks/usePagesScreen';
import { PagesScreenPage } from '../pages/PagesScreenPage';

const NOTHING = () => {};

/** /pages: a Line project gets the Line Pages screen with its Plan panel (every Save is a plan step the person
 * approves); any other project keeps today's Pages editor, untouched. */
export function PagesScreenController() {
  // The Plan panel asks for the plan only once the project is known to be a Line project.
  const [isLine, setIsLine] = useState(false);
  const plan = useLinePlan(NOTHING, undefined, isLine);
  const { phase, view } = usePagesScreen(plan);
  useEffect(() => setIsLine(phase === 'line'), [phase]);
  return (
    <PagesScreenPage
      phase={phase}
      view={view}
      fallback={<PagesEditorController />}
      panel={
        <>
          <LineTraceController screen="pages" steps={plan.steps} />
          <LineDraftController onAdded={plan.refresh} />
          <LinePlanController plan={plan} />
        </>
      }
    />
  );
}
