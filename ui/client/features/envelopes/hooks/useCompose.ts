'use client';

import { useCallback, useReducer } from 'react';
import { composeReducer, initialCompose } from '../workflows/Compose';
import type { ComposeApi, ComposeStep, Executor, FlowCatalogueEntry, FlowStep } from '../types';

function toComposeStep(step: FlowStep, index: number): ComposeStep {
  return {
    id: step.id ?? `loaded-${index}`,
    title: step.title ?? step.flow,
    flow: step.flow,
    args: step.args ?? {},
    executor: (step.executor as Executor | undefined) ?? 'deterministic',
  };
}

/** The compose draft -- #395/#771's center stage: add a catalogue flow, reorder, remove, or load a saved
 * flow's steps as the starting point. No save/run yet (#772); nothing here reaches the server. */
export function useCompose(): ComposeApi {
  const [state, dispatch] = useReducer(composeReducer, initialCompose);

  const addStep = useCallback((flow: FlowCatalogueEntry) => dispatch({ type: 'ADD', flow }), []);
  const removeStep = useCallback((id: string) => dispatch({ type: 'REMOVE', id }), []);
  const moveStep = useCallback((id: string, dir: -1 | 1) => dispatch({ type: 'MOVE', id, dir }), []);
  const loadFlow = useCallback((name: string, steps: FlowStep[]) => dispatch({ type: 'LOAD', name, steps: steps.map(toComposeStep) }), []);
  const newFlow = useCallback(() => dispatch({ type: 'NEW' }), []);

  return { state, addStep, removeStep, moveStep, loadFlow, newFlow };
}
