'use client';

import type { ReactNode } from 'react';
import { LineWorkflowsController } from '@/features/line-workflows';
import { LineTraceController } from '@/features/line-trace';
import { useLineFeatures } from '../hooks/useLineFeatures';
import { FeaturesSwitchPage } from '../pages/FeaturesSwitchPage';

/** The Features screen's feature part (`/`, `/plan`): a Line project gets the Line Features view (pick a feature, see
 * its items by kind, the Auto summary and its spec coverage, and its Workflows tab with the Plan panel); any other
 * project gets `fallback`, today's feature list and details, untouched. Mounted inside the Features stage, below its
 * project gate. */
export function LineFeaturesController({ fallback }: { fallback: ReactNode }) {
  const { phase, view } = useLineFeatures();
  const workflows = view.feature && view.tab === 'workflows' ? <LineWorkflowsController key={view.feature} feature={view.feature} /> : null;
  return <FeaturesSwitchPage phase={phase} view={view} fallback={fallback} workflows={workflows} trace={<LineTraceController screen="features" />} />;
}
