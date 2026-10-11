'use client';

import { useCallback, useState } from 'react';
import { LinePlanController, useLinePlan } from '@/features/line-plan';
import { useLineWorkflows } from '../hooks/useLineWorkflows';
import type { AddStep } from '../types';
import { LineWorkflowsPage } from '../pages/LineWorkflowsPage';

/** A feature's Workflows tab (inside the Line Features screen) with its own Plan panel: every change is a plan step the
 * person approves there; once one lands, the workflows are read again. */
export function LineWorkflowsController({ feature }: { feature: string }) {
  const [revision, setRevision] = useState(0);
  const landed = useCallback(() => setRevision((r) => r + 1), []);
  const plan = useLinePlan(landed);
  const view = useLineWorkflows(feature, plan.addStep, revision);
  return <LineWorkflowsPage view={view} panel={<LinePlanController plan={plan} />} />;
}

/** The Workflows tab inside a screen that already has the Plan panel (cd1's Features chat): the screen's plan adds the
 * steps, and `revision` (bumped when a step lands) reads the workflows again. One Plan panel per screen. */
export function LineWorkflowsTab({ feature, addStep, revision }: { feature: string; addStep: AddStep; revision: number }) {
  const view = useLineWorkflows(feature, addStep, revision);
  return <LineWorkflowsPage view={view} panel={null} />;
}
