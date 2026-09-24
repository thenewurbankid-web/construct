// Pure (WORKFLOW-001): what the Requirement screen knows, and how each event changes it. No I/O.
import type { ScreenAction, ScreenState } from '../domain/RequirementTypes.ts';

export const initialScreen: ScreenState = {
  text: '',
  answers: [],
  read: { status: 'idle', result: null, error: null },
  approve: { status: 'idle', processId: null, error: null },
  note: { status: 'idle', error: null },
};

const NO_APPROVE = initialScreen.approve;
const NO_NOTE = initialScreen.note;

export function screenReducer(state: ScreenState, action: ScreenAction): ScreenState {
  switch (action.type) {
    case 'TEXT':
      // New words make yesterday's answers, card and approval stale: everything downstream of the sentence starts over.
      return action.text === state.text ? state : { ...initialScreen, text: action.text };
    case 'ANSWERS':
      return { ...state, answers: action.answers, approve: NO_APPROVE, note: NO_NOTE };
    case 'READ_LOADING':
      // The card on screen stays until the new one arrives, so an answered question does not blink the page away.
      return { ...state, read: { ...state.read, status: 'loading', error: null } };
    case 'READ_LOADED':
      return { ...state, read: { status: 'ready', result: action.result, error: null }, approve: NO_APPROVE, note: NO_NOTE };
    case 'READ_FAILED':
      return { ...state, read: { status: 'failed', result: null, error: action.error } };
    case 'APPROVE_RUNNING':
      return { ...state, approve: { status: 'running', processId: null, error: null } };
    case 'APPROVE_STARTED':
      return { ...state, approve: { status: 'started', processId: action.processId, error: null } };
    case 'APPROVE_FAILED':
      return { ...state, approve: { status: 'failed', processId: null, error: action.error } };
    case 'NOTE_SAVING':
      return { ...state, note: { status: 'saving', error: null } };
    case 'NOTE_SAVED':
      return { ...state, note: { status: 'saved', error: null } };
    case 'NOTE_FAILED':
      return { ...state, note: { status: 'failed', error: action.error } };
    default:
      return state;
  }
}
