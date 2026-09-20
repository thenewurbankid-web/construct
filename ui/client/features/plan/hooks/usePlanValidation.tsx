'use client';

import { useEffect, useMemo, type Dispatch } from 'react';
import { buildPlan } from '../domain/PlanDocument';
import { validatePlanOnServer } from '../services/PlanCheckApi';
import type { ScreenAction, ScreenState } from '../domain/PlanTypes';

const DEBOUNCE_MS = 250;

/**
 * The plan document, and the server's verdict on it after EVERY edit (debounced). The client never decides
 * validity itself: `stale` is true while the last verdict answers an older plan, and Run stays off then.
 */
export function usePlanValidation(state: ScreenState, dispatch: Dispatch<ScreenAction>) {
  const plan = useMemo(() => buildPlan(state.ticket, state.steps), [state.ticket, state.steps]);
  const planKey = useMemo(() => JSON.stringify(plan), [plan]);
  const hasSteps = state.steps.length > 0;

  useEffect(() => {
    if (!hasSteps) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const r = await validatePlanOnServer(plan);
      if (!cancelled && r.ok) dispatch({ type: 'VALIDATED', validation: r.data, for: planKey });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [plan, planKey, hasSteps, dispatch]);

  const stale = state.validatedFor !== planKey;
  // Once started, Run stays off until the plan is edited again, so one press never starts two processes.
  const canRun = hasSteps && !stale && !!state.validation?.valid && state.runStatus !== 'loading' && !state.startedId;
  return { plan, stale, canRun };
}
