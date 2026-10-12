'use client';

import { useAiSteps } from '../hooks/useAiSteps';
import { useMemoryPanel } from '../hooks/useMemoryPanel';
import { AiStepsPanel } from '../pages/AiStepsPanel';

/** Settings' list of every AI step's profile (GET /api/line/ai-profiles) and the project's memory per step (im3 + j5). */
export function AiStepsController() {
  const view = useAiSteps();
  const memory = useMemoryPanel();
  return <AiStepsPanel view={view} memory={memory} />;
}
