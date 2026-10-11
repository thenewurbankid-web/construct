'use client';

import { useAiSteps } from '../hooks/useAiSteps';
import { AiStepsPanel } from '../pages/AiStepsPanel';

/** Settings' read-only list of every AI step's profile (GET /api/line/ai-profiles). */
export function AiStepsController() {
  const view = useAiSteps();
  return <AiStepsPanel view={view} />;
}
