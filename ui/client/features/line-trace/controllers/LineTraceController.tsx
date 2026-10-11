'use client';

import { useLineTrace } from '../hooks/useLineTrace';
import { LineTracePage } from '../pages/LineTracePage';
import type { PlanStepView, TraceScreen } from '../types';

/** The Trace bar for one Line screen. `steps`: the screen's plan steps (Components and Pages have a Plan panel). */
export function LineTraceController({ screen, steps }: { screen: TraceScreen; steps?: PlanStepView[] }) {
  const view = useLineTrace(screen, steps);
  return <LineTracePage view={view} />;
}
