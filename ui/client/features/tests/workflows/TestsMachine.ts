// Pure (WORKFLOW-001): what the Tests screen knows (feature, its listing, the selected test, the clone dialog,
// a generate run) and how each event changes it. No I/O here: the hook does the fetching.
import type { TestsAction, TestsState } from '../types.ts';

export const initialTests: TestsState = { feature: '', load: { status: 'idle' }, selected: null, code: { status: 'idle' }, dialog: null, generate: { status: 'idle' }, notice: null };

export function testsReducer(state: TestsState, action: TestsAction): TestsState {
  switch (action.type) {
    case 'PICK_FEATURE':
      return { ...initialTests, feature: action.feature };
    case 'LOADING':
      return { ...state, load: { status: 'loading' } };
    case 'LOADED':
      return { ...state, load: { status: 'ready', data: action.data } };
    case 'FAILED':
      return { ...state, load: { status: 'error', message: action.message } };
    case 'SELECT':
      return { ...state, selected: action.selection, code: { status: 'idle' } };
    case 'CODE_LOADING':
      return { ...state, code: { status: 'loading' } };
    case 'CODE_READY':
      return { ...state, code: { status: 'ready', path: action.path, text: action.text } };
    case 'CODE_FAILED':
      return { ...state, code: { status: 'error', message: action.message } };
    case 'CODE_HIDE':
      return { ...state, code: { status: 'idle' } };
    case 'OPEN_DIALOG':
      return { ...state, dialog: { ...action.dialog, busy: false, error: null } };
    case 'EDIT_NAME':
      return state.dialog ? { ...state, dialog: { ...state.dialog, name: action.name, error: null } } : state;
    case 'CLOSE_DIALOG':
      return { ...state, dialog: null };
    case 'CLONE_START':
      return state.dialog ? { ...state, dialog: { ...state.dialog, busy: true, error: null } } : state;
    case 'CLONE_FAILED':
      return state.dialog ? { ...state, dialog: { ...state.dialog, busy: false, error: action.error, name: action.suggested ? action.suggested : state.dialog.name } } : state;
    case 'CLONE_DONE':
      return { ...state, dialog: null, selected: { area: 'yours', name: action.name }, code: { status: 'idle' }, notice: `Cloned to ${action.path}. It is yours: nothing regenerates it.` };
    case 'GENERATE_START':
      return { ...state, generate: { status: 'running' } };
    case 'GENERATE_DONE':
      return { ...state, generate: { status: 'done', written: action.written } };
    case 'GENERATE_FAILED':
      return { ...state, generate: { status: 'error', message: action.message } };
    case 'DISMISS_NOTICE':
      return { ...state, notice: null };
    default:
      return state;
  }
}
