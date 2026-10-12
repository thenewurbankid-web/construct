'use client';

import { useCallback } from 'react';
import { planDecisionOn } from '../domain/PlanOptions';
import type { PlanStepRow, StepChoice } from '../types';

type PlanActions = { rows: PlanStepRow[]; approve: (stepId: string) => void; choose: (stepId: string, choice: StepChoice) => void };

/** Two modes: runs a picked "<screen>.plan.*" chat option through the same Plan actions as the panel's buttons. Answers
 * whether the option was the Plan's (so the screen handles the rest). */
export function usePlanChatOptions(screen: string, { rows, approve, choose }: PlanActions) {
  return useCallback(
    (optionId: string): boolean => {
      const decision = planDecisionOn(screen, optionId, rows);
      if (decision?.kind === 'approve') approve(decision.stepId);
      if (decision?.kind === 'choose') choose(decision.stepId, decision.choice);
      return decision !== null;
    },
    [screen, rows, approve, choose],
  );
}
