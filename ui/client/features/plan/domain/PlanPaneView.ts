// Pure (DOMAIN-001): the plan pane's props from the screen state.
import type { ScreenState } from './PlanTypes.ts';
import type { PlanHandlers } from '../types.ts';
import type { PlanPaneProps } from '../types.ts';
import { runBar } from './RunBarView.ts';
import { errorViews, splitErrors } from './StepErrors.ts';
import { buildStepView } from './StepView.ts';

export function buildPlanPane(s: ScreenState, stale: boolean, canRun: boolean, suggestionCount: number, h: PlanHandlers): PlanPaneProps {
  const { byStep, plan } = splitErrors(s.steps, s.validation?.errors ?? []);
  const flows = s.context?.flows ?? [];
  return {
    count: s.steps.length,
    steps: s.steps.map((step) => ({
      view: buildStepView({ step, flow: flows.find((f) => f.id === step.flow) ?? null, preview: s.validation?.steps.find((p) => p.id === step.id) ?? null, errors: byStep[step.id] ?? [] }),
    })),
    planErrors: errorViews(plan),
    catalogue: { flows: flows.filter((f) => f.offered).map((f) => ({ id: f.id, label: `${f.id} — ${f.summary.slice(0, 60)}` })), suggestionCount, onAdd: h.onAdd, onAddSuggested: h.onAddSuggested },
    run: runBar(s, stale, canRun, h),
    onMove: h.onMove,
    onRemove: h.onRemove,
    onRetag: h.onRetag,
    onArg: h.onArg,
    onTitle: h.onTitle,
  };
}
