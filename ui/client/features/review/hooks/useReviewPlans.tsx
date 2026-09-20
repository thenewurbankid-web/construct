'use client';

import { useEffect, useState } from 'react';
import { fetchPlans } from '../services/PlansApi';
import type { PlanChoice } from '../types';

/** The saved plans of the current project (the plans of its processes), read once per screen. */
export function useReviewPlans(): PlanChoice[] {
  const [plans, setPlans] = useState<PlanChoice[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchPlans().then((p) => { if (!cancelled) setPlans(p); });
    return () => { cancelled = true; };
  }, []);
  return plans;
}
