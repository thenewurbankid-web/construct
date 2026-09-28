'use client';

import { useCallback, useState } from 'react';
import { generateTests } from '@/features/tests';
import type { GenerateMode, GenerateResult as ControlResult } from '@/features/generate-control';
import { applyAutoMap, getUnmappedProps } from '../services/AutoMapApi';
import type { PageTree } from '../types';

export type SuggestedStepId = 'add-missing-layers' | 'automap-props' | 'generate-tests';

type StepRun = { running: boolean; result: ControlResult | null };

const IDLE: StepRun = { running: false, result: null };

/** Runs the three "first wired" suggested next steps (issue #382) from the Pages editor's
 * inspector. Only the mechanical path is wired today (see the honest catalogue in
 * docs/design/ia-five-screens.md section 8.7): auto-map and test generation already have a
 * deterministic block and write directly (no Approvals routing yet, tracked as a follow-up);
 * missing layer files has a CLI block but no HTTP endpoint, so it stays disabled with a reason
 * rather than being mislabelled "AI only / no block yet". */
export function useSuggestedNextSteps(feature: string, file: string, nodeId: string, contentHash: string, onSaved: (tree: PageTree) => void) {
  const [runs, setRuns] = useState<Record<SuggestedStepId, StepRun>>({
    'add-missing-layers': IDLE,
    'automap-props': IDLE,
    'generate-tests': IDLE,
  });

  const setRun = useCallback((id: SuggestedStepId, run: StepRun) => {
    setRuns((prev) => ({ ...prev, [id]: run }));
  }, []);

  const runAutoMap = useCallback(
    async (_mode: GenerateMode) => {
      setRun('automap-props', { running: true, result: null });
      const { candidates } = await getUnmappedProps(feature, file, nodeId);
      if (candidates.length === 0) {
        setRun('automap-props', { running: false, result: { ok: true, summary: 'Nothing unmapped.' } });
        return;
      }
      const outcome = await applyAutoMap({ feature, file, nodeId, propNames: candidates, contentHash });
      if (outcome.ok) onSaved(outcome);
      setRun('automap-props', {
        running: false,
        result: outcome.ok
          ? { ok: true, summary: `Wired ${candidates.length} prop(s).` }
          : { ok: false, summary: outcome.error || 'Auto-map failed.' },
      });
    },
    [feature, file, nodeId, contentHash, onSaved, setRun],
  );

  const runGenerateTests = useCallback(
    async (_mode: GenerateMode) => {
      setRun('generate-tests', { running: true, result: null });
      const result = await generateTests(feature);
      setRun('generate-tests', {
        running: false,
        result: result.ok
          ? { ok: true, summary: `Generated ${result.written.length} test(s).` }
          : { ok: false, summary: result.error },
      });
    },
    [feature, setRun],
  );

  const cancel = useCallback((id: SuggestedStepId) => setRun(id, IDLE), [setRun]);

  return { runs, runAutoMap, runGenerateTests, cancel };
}
