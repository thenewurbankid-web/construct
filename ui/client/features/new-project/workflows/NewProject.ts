import { assign, setup } from 'xstate';
import { nextStep, previousStep } from '../domain/NewProjectSteps.ts';
import { canLeaveStep, refusalStep } from '../domain/NewProjectStepRules.ts';
import { DEFAULT_FIRST_FEATURE } from '../domain/ProjectKinds.ts';
import type { NewProjectFormState, NewProjectFramework, NewProjectStep } from '../types';

// Workflows own application state and flow but never import React (WORKFLOW-001) —
// a real XState machine (#449: one dogfooded workflow construct's research/test
// tooling can read statically, see docs/DOGFOODING-2026-09.md).

export type NewProjectEvent =
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_FRAMEWORK'; framework: NewProjectFramework }
  | { type: 'SET_FEATURE'; firstFeature: string }
  | { type: 'SET_PARENT'; parentDir: string }
  /** Next (or Enter) on a question; ignored until that question has a usable answer. */
  | { type: 'NEXT' }
  | { type: 'BACK' }
  /** Straight to one question (the chat helper filling the series, or a refusal sending the person back). */
  | { type: 'GO'; step: NewProjectStep }
  | { type: 'START' }
  | { type: 'REFUSED'; error: string }
  | { type: 'CREATED' };

// A Line project is the recommended kind, so it is chosen to start with, with one empty first feature ("home").
export const initialNewProjectState: NewProjectFormState = { step: 'name', name: '', framework: 'line', firstFeature: DEFAULT_FIRST_FEATURE, parentDir: '', creating: false, error: null };

export const newProjectMachine = setup({
  types: {} as {
    context: NewProjectFormState;
    events: NewProjectEvent;
  },
  actions: {
    // A new name or framework starts fresh: a refusal of the old attempt no longer applies.
    setName: assign({ name: ({ event }) => (event.type === 'SET_NAME' ? event.name : ''), error: null }),
    setFramework: assign({ framework: ({ event }) => (event.type === 'SET_FRAMEWORK' ? event.framework : 'nextjs'), error: null }),
    setFeature: assign({ firstFeature: ({ event }) => (event.type === 'SET_FEATURE' ? event.firstFeature : ''), error: null }),
    setParent: assign({ parentDir: ({ event }) => (event.type === 'SET_PARENT' ? event.parentDir : ''), error: null }),
    // A refusal is shown on the question it belongs to.
    recordRefusal: assign({
      error: ({ event }) => (event.type === 'REFUSED' ? event.error : null),
      step: ({ event, context }) => (event.type === 'REFUSED' ? refusalStep(event.error) : context.step),
    }),
    next: assign({ step: ({ context }) => nextStep(context.step), error: null }),
    back: assign({ step: ({ context }) => previousStep(context.step), error: null }),
    go: assign({ step: ({ event, context }) => (event.type === 'GO' ? event.step : context.step) }),
  },
  guards: {
    canLeave: ({ context }) => context.step !== 'confirm' && canLeaveStep(context.step, context),
  },
}).createMachine({
  id: 'newProject',
  initial: 'editing',
  context: initialNewProjectState,
  states: {
    editing: {
      on: {
        SET_NAME: { actions: 'setName' },
        SET_FRAMEWORK: { actions: 'setFramework' },
        SET_FEATURE: { actions: 'setFeature' },
        SET_PARENT: { actions: 'setParent' },
        NEXT: { guard: 'canLeave', actions: 'next' },
        BACK: { actions: 'back' },
        GO: { actions: 'go' },
        START: { target: 'creating' },
      },
    },
    creating: {
      on: {
        REFUSED: { target: 'editing', actions: 'recordRefusal' },
        // The caller's onCreated navigates the screen away right after; this only marks the flow done.
        CREATED: { target: 'created' },
      },
    },
    created: { type: 'final' },
  },
});

/** The page's own view of a snapshot: `NewProjectFormState`, as it was when this was a plain reducer. */
export function formStateOf(snapshot: { value: string; context: NewProjectFormState }): NewProjectFormState {
  return { ...snapshot.context, creating: snapshot.value === 'creating' };
}
