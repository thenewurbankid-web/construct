// Pure (WORKFLOW-001): the state machine of the compose draft -- #395/#771's center stage. Delegates the
// list-shape decisions to domain/ComposeSteps.ts; this only owns nextId/loadedFrom bookkeeping.
import { addComposeStep, moveComposeStep, removeComposeStep } from '../domain/ComposeSteps';
import type { ComposeAction, ComposeState } from '../types';

export const initialCompose: ComposeState = { steps: [], nextId: 1, loadedFrom: null };

export function composeReducer(state: ComposeState, action: ComposeAction): ComposeState {
  switch (action.type) {
    case 'ADD': {
      const { steps, nextId } = addComposeStep(action.flow, state.steps, state.nextId);
      return { ...state, steps, nextId };
    }
    case 'REMOVE':
      return { ...state, steps: removeComposeStep(state.steps, action.id) };
    case 'MOVE':
      return { ...state, steps: moveComposeStep(state.steps, action.id, action.dir) };
    case 'LOAD':
      return { steps: action.steps, nextId: action.steps.length + 1, loadedFrom: action.name };
    case 'NEW':
      return initialCompose;
    default:
      return state;
  }
}
