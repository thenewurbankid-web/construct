// The Import agent screen's state: one call at a time; a view replaces the last one; a refusal keeps the view and says why.
// Changing the folder forgets the old folder's view.
import type { AgentEvent, AgentState } from '../types.ts';

export const initialAgent: AgentState = { folders: null, folder: '', view: null, busy: false, error: null, editing: null };

export function agentReducer(state: AgentState, event: AgentEvent): AgentState {
  switch (event.type) {
    case 'FOLDERS':
      return { ...state, folders: event.folders };
    case 'SET_FOLDER':
      return state.busy ? state : { ...state, folder: event.folder, view: null, error: null, editing: null };
    case 'CALL':
      return { ...state, busy: true, error: null };
    case 'VIEW':
      return { ...state, busy: false, view: event.view, editing: null };
    case 'REFUSED':
      return { ...state, busy: false, error: event.sentence };
    case 'EDIT':
      return { ...state, editing: event.stepId };
    default:
      return state;
  }
}
