'use client';

import { GenerateControl, useGenerateMode } from '@/features/generate-control';
import { useStoryCompareAi } from '../hooks/useStoryCompareAi';
import type { StoryCoverage } from '../types';

type StoryCompareControlProps = { feature: string; story: StoryCoverage; codeUnits: string[] };

/** Mirrors packages/core/llm.mjs's DEFAULT_OLLAMA_MODEL for display only -- AI compare always uses the local
 * model (design 8.6 guardrail 2: "Claude is not offered here"), never a hosted provider. */
const MODEL = 'qwen2.5-coder:7b';

/** AI compare (#388), behind the Mechanical | AI toggle: the mechanical side is the three-list compare already on
 * this screen (0 model calls); choosing AI cites which code unit(s) satisfy which acceptance line, verified
 * mechanically before the result is ever shown. Renders only when the feature has a story.md (design 9.1
 * activation rule: story-dependent UI exists only then). */
export function StoryCompareControl({ feature, story, codeUnits }: StoryCompareControlProps) {
  const genMode = useGenerateMode('story-compare');
  const { running, result, run, cancel } = useStoryCompareAi(feature);
  if (!story.declared) return null;

  const bytes = new Blob([JSON.stringify({ acceptance: story.acceptance, codeUnits })]).size;

  return (
    <div className="ts-story-compare" data-testid="story-compare-ai">
      <GenerateControl
        actionId="story-compare-ai"
        actionKind="story-compare"
        label="AI compare (cites acceptance lines and code units)"
        mechanical={{ block: 'story.compareStory', command: 'GET /api/tests/:feature' }}
        ai={{ allowed: true, model: MODEL }}
        willSend={{ files: 1, bytes, calls: 1 }}
        target={feature}
        modelOffline={genMode.modelOffline}
        mode={genMode.mode}
        running={running}
        result={result}
        onRun={run}
        onCancel={cancel}
        onChooseMode={genMode.chooseMode}
      />
    </div>
  );
}
