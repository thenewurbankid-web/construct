'use client';

import { useMemo } from 'react';
import { withPlan } from '../services/LinePagesApi';
import type { LinePagesPlan } from '../types';
import { useLinePages } from './useLinePages';
import { useLineProject } from './useLineProject';

/** /pages: which screen to show ("loading", "line" or "not-line") and, for a Line project, its view. Its writes are
 * steps of the project's plan (`plan`: the Plan panel's addStep and the step the person last ran). */
export function usePagesScreen(plan: LinePagesPlan) {
  const { state, reload } = useLineProject();
  const line = state.phase === 'line' ? state : null;
  const base = line?.api ?? null;
  const { addStep } = plan;
  const api = useMemo(() => (base ? withPlan(base, addStep) : null), [base, addStep]);
  const view = useLinePages(line?.project ?? null, api, reload, plan.lastRun);
  return { phase: state.phase === 'line' && !view.ready ? ('loading' as const) : state.phase, view };
}
