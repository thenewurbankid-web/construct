'use client';

import { useCallback, useMemo, type Dispatch } from 'react';
import { newStep, removeStep, moveStep } from '../domain/StepList';
import { retagStep, setStepArg, setStepTitle } from '../domain/StepEdit';
import { suggestedSteps } from '../domain/SuggestedSteps';
import type { Executor, FlowInfo, PlanStep, ScreenAction, ScreenState } from '../domain/PlanTypes';

/** Every edit of the step list. Each one only reshapes the list; whether the result is valid is the server's answer. */
export function useStepActions(state: ScreenState, dispatch: Dispatch<ScreenAction>, flows: FlowInfo[]) {
  const flowOf = useCallback((id: string) => flows.find((f) => f.id === id) ?? null, [flows]);
  const set = useCallback((steps: PlanStep[], nextId: number = state.nextId) => dispatch({ type: 'STEPS', steps, nextId }), [dispatch, state.nextId]);
  const flowOfStep = (id: string) => flowOf(state.steps.find((s) => s.id === id)?.flow ?? '');

  const addStep = useCallback(
    (flowId: string) => {
      const flow = flowOf(flowId);
      if (!flow) return;
      const made = newStep(flow, state.steps, state.nextId);
      set([...state.steps, made.step], made.nextId);
    },
    [flowOf, state.steps, state.nextId, set],
  );

  const suggestions = useMemo(() => suggestedSteps(state.impact, state.steps), [state.impact, state.steps]);
  const addSuggested = useCallback(() => {
    let steps = state.steps;
    let counter = state.nextId;
    for (const s of suggestions) {
      const flow = flowOf(s.flow);
      if (!flow) continue;
      const made = newStep(flow, steps, counter);
      steps = [...steps, { ...made.step, ...s, id: made.step.id }];
      counter = made.nextId;
    }
    set(steps, counter);
  }, [suggestions, flowOf, state.steps, state.nextId, set]);

  return {
    suggestions,
    addStep,
    addSuggested,
    move: (id: string, dir: -1 | 1) => set(moveStep(state.steps, id, dir)),
    remove: (id: string) => set(removeStep(state.steps, id)),
    retag: (id: string, e: Executor) => set(retagStep(state.steps, id, e, flowOfStep(id))),
    setArg: (id: string, name: string, v: string) => set(setStepArg(state.steps, id, name, v, flowOfStep(id))),
    setTitle: (id: string, title: string) => set(setStepTitle(state.steps, id, title)),
  };
}
