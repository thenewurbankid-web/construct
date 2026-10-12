'use client';

import { useCallback } from 'react';
import { usePlanChatOptions } from '@/features/line-plan';
import type { Place } from '@/lib/lineModes';
import type { ChangeControls, LibraryView } from '../types';

type PlanActions = Parameters<typeof usePlanChatOptions>[1];
const stepOf = (place: Place, param: string) => place.steps.find((s) => s.param === param)?.id ?? null;

/** Two modes on Components: the options the chat does not answer. The Plan's decisions run through the panel's actions;
 * Promote opens the same confirm as the row's button. */
export function useComponentsChatOptions(view: LibraryView | null, plan: PlanActions, openPromote: ChangeControls['openPromote']) {
  const runPlan = usePlanChatOptions('components', plan);
  return useCallback(
    (optionId: string, place: Place) => {
      if (runPlan(optionId) || optionId !== 'components.promote' || !view) return;
      const feature = view.features.find((f) => f.name === stepOf(place, 'feature'));
      const row = feature?.rows.find((r) => r.name === stepOf(place, 'component'));
      if (row) openPromote(row.id, row.name);
    },
    [runPlan, view, openPromote],
  );
}
