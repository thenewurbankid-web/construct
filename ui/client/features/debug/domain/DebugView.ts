// Pure (DOMAIN-001): ScreenState -> the view model DebugPage renders. Composes the visible steps (the ones already
// answered plus the one now being asked; the server always returns all four summaries, but a step past `current`
// has not been reached yet and stays hidden) and the Approve bar's state.
import { STEP_ORDER } from './DebugTypes';
import type { ScreenState } from './DebugTypes';
import type { DebugStepView, DebugViewModel } from '../types';

function visibleSteps(state: ScreenState): DebugStepView[] {
  const result = state.read.result;
  if (!result) return [];
  const idx = result.current ? STEP_ORDER.indexOf(result.current) : STEP_ORDER.length - 1;
  return STEP_ORDER.slice(0, idx + 1).map((id) => ({
    id,
    summary: result.summaries[id],
    exit: result.exits[id],
    answered: id !== result.current,
  }));
}

export function buildDebugView(state: ScreenState): DebugViewModel {
  const result = state.read.result;
  const plan = result?.plan ?? null;
  const done = result?.done ?? false;
  const compileError = result?.errors?.[0]?.message ?? null;
  return {
    feature: state.feature,
    canStart: state.feature.trim().length > 0 && state.read.status !== 'loading',
    read: { status: state.read.status, error: state.read.error },
    steps: visibleSteps(state),
    done,
    plan,
    compileError,
    approve: {
      canApprove: !!plan && state.approve.status !== 'loading' && state.approve.status !== 'ready' && state.verify.status !== 'passed',
      running: state.approve.status === 'loading',
      started: state.approve.status === 'ready',
      processId: state.approve.processId,
      error: state.approve.error,
    },
    verifyPrompt: state.verify.status === 'awaiting',
    verifyPassed: state.verify.status === 'passed',
    iterations: state.verify.iterations,
  };
}
