// Pure (WORKFLOW-001): what the Debug screen knows, and how each event changes it. No I/O.
import type { ScreenAction, ScreenState } from '../domain/DebugTypes';

export const initialScreen: ScreenState = {
  feature: '',
  answers: [],
  read: { status: 'idle', error: null, result: null },
  approve: { status: 'idle', error: null, processId: null },
  verify: { status: 'idle', iterations: 0 },
};

export function screenReducer(state: ScreenState, action: ScreenAction): ScreenState {
  switch (action.type) {
    case 'FEATURE':
      return { ...state, feature: action.feature };
    case 'READ_LOADING':
      return { ...state, read: { ...state.read, status: 'loading', error: null } };
    case 'READ_LOADED':
      return {
        ...state,
        read: { status: 'ready', error: null, result: action.result },
        // Once every chooser is answered and a plan compiled, a person marks whether the run passed; a chain that
        // is still being answered, or one whose answers failed to compile, has nothing to mark yet.
        verify: action.result.done && action.result.plan ? { ...state.verify, status: 'awaiting' } : { ...state.verify, status: 'idle' },
      };
    case 'READ_FAILED':
      return { ...state, read: { ...state.read, status: 'failed', error: action.error } };
    case 'ANSWERS':
      return { ...state, answers: action.answers, approve: { status: 'idle', error: null, processId: null } };
    case 'APPROVE_LOADING':
      return { ...state, approve: { status: 'loading', error: null, processId: null } };
    case 'APPROVE_STARTED':
      return { ...state, approve: { status: 'ready', error: null, processId: action.processId } };
    case 'APPROVE_FAILED':
      return { ...state, approve: { status: 'failed', error: action.error, processId: null } };
    case 'VERIFY_RESULT':
      return { ...state, verify: { status: action.passed ? 'passed' : 'idle', iterations: action.passed ? state.verify.iterations : state.verify.iterations + 1 } };
    default:
      return state;
  }
}
