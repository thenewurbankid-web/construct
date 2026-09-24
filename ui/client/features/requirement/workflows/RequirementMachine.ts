// Pure (WORKFLOW-001): what the Requirement screen knows, and how each event changes it. No I/O.
import type { ScreenAction, ScreenState } from '../domain/RequirementTypes.ts';

export const initialScreen: ScreenState = {
  text: '',
  answers: [],
  read: { status: 'idle', result: null, error: null },
  approve: { status: 'idle', processId: null, error: null },
  note: { status: 'idle', error: null },
  proof: { applied: null, options: [], run: { status: 'idle', result: null, error: null }, skip: { status: 'idle', draft: '', reason: null, error: null } },
};

const NO_APPROVE = initialScreen.approve;
const NO_NOTE = initialScreen.note;
const NO_PROOF = initialScreen.proof;

export function screenReducer(state: ScreenState, action: ScreenAction): ScreenState {
  switch (action.type) {
    case 'TEXT':
      // New words make yesterday's answers, card and approval stale: everything downstream of the sentence starts over.
      return action.text === state.text ? state : { ...initialScreen, text: action.text };
    case 'ANSWERS':
      return { ...state, answers: action.answers, approve: NO_APPROVE, note: NO_NOTE, proof: NO_PROOF };
    case 'READ_LOADING':
      // The card on screen stays until the new one arrives, so an answered question does not blink the page away.
      return { ...state, read: { ...state.read, status: 'loading', error: null } };
    case 'READ_LOADED':
      return { ...state, read: { status: 'ready', result: action.result, error: null }, approve: NO_APPROVE, note: NO_NOTE, proof: NO_PROOF };
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
    // #653: the proof of the screen. A run or a skip that is still going cannot be started again; a new plan (above) starts all over.
    case 'PROOF_APPLIED':
      return { ...state, proof: { ...state.proof, applied: action.applied, options: state.proof.run.result?.summary.options ?? action.options } };
    case 'PROOF_RUN_STARTED':
      return { ...state, proof: { ...state.proof, run: { status: 'running', result: state.proof.run.result, error: null } } };
    case 'PROOF_RUN_DONE':
      // A run supersedes an earlier skip: the chain is what the last word says.
      return { ...state, proof: { ...state.proof, applied: true, options: action.run.summary.options, run: { status: 'done', result: action.run, error: null }, skip: { ...NO_PROOF.skip, draft: state.proof.skip.draft } } };
    case 'PROOF_RUN_FAILED':
      return { ...state, proof: { ...state.proof, applied: action.applied ?? state.proof.applied, run: { status: 'failed', result: state.proof.run.result, error: action.error } } };
    case 'PROOF_SKIP_OPEN':
      return { ...state, proof: { ...state.proof, skip: { ...state.proof.skip, status: 'open', error: null } } };
    case 'PROOF_SKIP_CANCEL':
      return { ...state, proof: { ...state.proof, skip: { ...state.proof.skip, status: 'idle', error: null } } };
    case 'PROOF_SKIP_DRAFT':
      return { ...state, proof: { ...state.proof, skip: { ...state.proof.skip, draft: action.draft, error: null } } };
    case 'PROOF_SKIP_SAVING':
      return { ...state, proof: { ...state.proof, skip: { ...state.proof.skip, status: 'saving', error: null } } };
    case 'PROOF_SKIP_DONE':
      return { ...state, proof: { ...state.proof, skip: { status: 'skipped', draft: '', reason: action.reason, error: null } } };
    case 'PROOF_SKIP_FAILED':
      return { ...state, proof: { ...state.proof, skip: { ...state.proof.skip, status: 'open', error: action.error } } };
    default:
      return state;
  }
}
