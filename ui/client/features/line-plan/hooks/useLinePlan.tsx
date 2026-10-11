'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { planRows } from '../domain/PlanRows';
import { changeResult, lastRun } from '../domain/PlanResult';
import { linePlanApi } from '../services/LinePlanApi';
import { approveAndRun, chooseAndRun } from '../workflows/ApproveFlow';
import type { LinePlanApi, PlanAnswer, PlanControls, PlanStepRequest, PlanStepView, PlanView, StepChoice } from '../types';

const NO_STEPS: PlanStepView[] = [];

/** The open project's plan (GET /api/line/plan) and the person's part in it: a Line action adds a step, Approve runs
 * it, and a step that needs the person offers Try again or Leave as it is. `onLanded` runs after a step wrote files
 * (re-read the project, re-run validate). */
export function useLinePlan(onLanded: () => void, api: LinePlanApi = linePlanApi): PlanControls {
  const [view, setView] = useState<PlanView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The step the person ran on this screen, for the screen's own notice (an old plan's last step is not news). */
  const [ranId, setRanId] = useState<string | null>(null);
  const landed = useRef(onLanded);
  landed.current = onLanded;

  const take = useCallback((answer: PlanAnswer, ranStep?: string) => {
    if (!answer.ok) {
      setError(answer.sentence);
      return;
    }
    setError(null);
    setView(answer.view);
    const step = ranStep ? answer.view.steps.find((s) => s.id === ranStep) : undefined;
    if (step) setRanId(step.id);
    const r = step ? changeResult(step) : null;
    if (r && r.apply.ok && r.apply.files.length) landed.current();
  }, []);

  const refresh = useCallback(() => {
    void api.getPlan().then((a) => take(a));
  }, [api, take]);
  useEffect(() => refresh(), [refresh]);
  /** After a refusal: show the plan as it is now, keeping the refusal's sentence. */
  const reread = useCallback(() => {
    void api.getPlan().then((g) => {
      if (g.ok) setView(g.view);
    });
  }, [api]);

  const addStep = useCallback(
    async (req: PlanStepRequest) => {
      const a = await api.addStep(req);
      take(a);
      if (!a.ok) {
        setError(null);
        return a;
      }
      const step = a.view.steps.find((s) => s.id === a.view.stepId);
      return { ok: true, sentence: step ? step.sentence : 'The step was added to the plan.' };
    },
    [api, take],
  );

  const approve = useCallback(
    (stepId: string) => {
      setBusy(true);
      void approveAndRun(api, stepId).then((a) => {
        take(a, stepId);
        setBusy(false);
        if (!a.ok) reread();
      });
    },
    [api, take, reread],
  );

  const choose = useCallback(
    (stepId: string, choice: StepChoice) => {
      const tool = view?.steps.find((s) => s.id === stepId)?.tool ?? '';
      setBusy(true);
      void chooseAndRun(api, tool, stepId, choice).then((a) => {
        const ran = a.ok ? a.view.steps[a.view.steps.length - 1]?.id : undefined;
        take(a, ran);
        setBusy(false);
        if (!a.ok) reread();
      });
    },
    [api, view, take, reread],
  );

  return useMemo(
    () => ({ rows: planRows(view), steps: view?.steps ?? NO_STEPS, storeSentence: view?.store.sentence ?? '', error, busy, lastRun: lastRun(view, ranId), addStep, approve, choose, refresh }),
    [view, ranId, error, busy, addStep, approve, choose, refresh],
  );
}
