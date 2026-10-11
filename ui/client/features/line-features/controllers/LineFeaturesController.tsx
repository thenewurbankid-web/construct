'use client';

import type { ReactNode } from 'react';
import { LineTraceController } from '@/features/line-trace';
import { useLineFeatures } from '../hooks/useLineFeatures';
import { FeaturesSwitchPage } from '../pages/FeaturesSwitchPage';

/** The Features screen's feature part (`/`, `/plan`): a Line project gets the Line Features view (pick a feature, see
 * its items by kind, the Auto summary and its spec coverage); any other project gets `fallback`, today's feature list
 * and details, untouched. Mounted inside the Features stage, below its project gate. */
export function LineFeaturesController({ fallback }: { fallback: ReactNode }) {
  const { phase, view } = useLineFeatures();
  return <FeaturesSwitchPage phase={phase} view={view} fallback={fallback} trace={<LineTraceController screen="features" />} />;
}
