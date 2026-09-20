// Pure (DOMAIN-001): the Run bar: where a model will be used, and why Run is off.
import type { PlanStep, ScreenState } from './PlanTypes.ts';
import type { RunBarProps } from '../types.ts';
import type { PlanHandlers } from '../types.ts';

export const modelNotice = (models: PlanStep[]): string | null =>
  models.length
    ? `${models.length} step${models.length === 1 ? ' uses' : 's use'} the local model: ${models.map((s) => s.title).join('; ')}. You approve its output before it reaches your project.`
    : null;

export const blockedReason = (s: ScreenState, stale: boolean, canRun: boolean): string | null => {
  if (!s.steps.length || canRun || s.runStatus === 'loading') return null;
  if (stale) return 'Checking the plan...';
  return s.validation && !s.validation.valid ? 'Fix the errors above before this plan can run.' : null;
};

export const runBar = (s: ScreenState, stale: boolean, canRun: boolean, h: PlanHandlers): RunBarProps => ({
  modelNotice: modelNotice(s.steps.filter((x) => x.executor === 'local-model')),
  blocked: blockedReason(s, stale, canRun),
  canRun,
  runStatus: s.runStatus,
  runError: s.runError,
  started: !!s.startedId,
  onRun: h.onRun,
  onOpenProcesses: h.onOpenProcesses,
});
