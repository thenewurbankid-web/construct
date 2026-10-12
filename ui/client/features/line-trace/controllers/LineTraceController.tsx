'use client';

import { useLineTrace } from '../hooks/useLineTrace';
import { LineTracePage } from '../pages/LineTracePage';
import type { LineTraceApi, PlanStepView, TraceScreen } from '../types';

/** The Trace bar for one Line screen. `steps`: the screen's plan steps (Components and Pages have a Plan panel). `api`:
 * how the screen's requests are matched (the server's POST /api/line/trace unless the screen brings its own). */
export function LineTraceController({ screen, steps, api }: { screen: TraceScreen; steps?: PlanStepView[]; api?: LineTraceApi }) {
  const view = useLineTrace(screen, steps, api);
  return <LineTracePage view={view} />;
}
