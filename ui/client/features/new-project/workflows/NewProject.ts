import { assign, setup } from 'xstate';
import type { NewProjectFormState, NewProjectFramework } from '../types';

// Workflows own application state and flow but never import React (WORKFLOW-001) —
// a real XState machine (#449: one dogfooded workflow construct's research/test
// tooling can read statically, see docs/DOGFOODING-2026-09.md).

export type NewProjectEvent =
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_FRAMEWORK'; framework: NewProjectFramework }
  | { type: 'START' }
  | { type: 'REFUSED'; error: string }
  | { type: 'CREATED' };

export const initialNewProjectState: NewProjectFormState = { name: '', framework: 'nextjs', creating: false, error: null };

export const newProjectMachine = setup({
  types: {} as {
    context: NewProjectFormState;
    events: NewProjectEvent;
  },
  actions: {
    // A new name or framework starts fresh: a refusal of the old attempt no longer applies.
    setName: assign({ name: ({ event }) => (event.type === 'SET_NAME' ? event.name : ''), error: null }),
    setFramework: assign({ framework: ({ event }) => (event.type === 'SET_FRAMEWORK' ? event.framework : 'nextjs'), error: null }),
    recordRefusal: assign({ error: ({ event }) => (event.type === 'REFUSED' ? event.error : null) }),
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
