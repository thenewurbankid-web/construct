'use client';

import { LinePlanPage } from '../pages/LinePlanPage';
import type { PlanControls } from '../types';

/** The Plan panel for a screen that owns the plan's state (useLinePlan): drop it into the Components or Pages screen. */
export function LinePlanController({ plan }: { plan: PlanControls }) {
  return <LinePlanPage plan={plan} />;
}
