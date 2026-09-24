// Pure (WORKFLOW-001): what the Plan screen knows, and how each event changes it. No I/O.
import type { ScreenAction, ScreenState } from '../domain/PlanTypes';
import { noteMeta, screenFromNote } from '../domain/PlanNote.ts';

export const initialScreen: ScreenState = {
  contextStatus: 'idle',
  contextError: null,
  context: null,
  ticket: { title: '', body: '' },
  picked: [],
  proposals: null,
  proposalsStatus: 'idle',
  proposalsError: null,
  accepted: [],
  impactStatus: 'idle',
  impactError: null,
  impact: null,
  impactSeeds: { explicit: 0, inferred: 0 },
  steps: [],
  nextId: 1,
  validation: null,
  validatedFor: null,
  runStatus: 'idle',
  runError: null,
  runErrors: [],
  startedId: null,
  startedModels: [],
  note: null,
  noteSave: { status: 'idle' },
};

const toggle = (list: string[], ref: string): string[] => (list.includes(ref) ? list.filter((r) => r !== ref) : [...list, ref]);

export function screenReducer(state: ScreenState, action: ScreenAction): ScreenState {
  switch (action.type) {
    case 'CONTEXT_LOADING':
      return { ...state, contextStatus: 'loading', contextError: null };
    case 'CONTEXT_LOADED':
      return { ...state, contextStatus: 'ready', context: action.context };
    case 'CONTEXT_FAILED':
      return { ...state, contextStatus: 'failed', contextError: action.error };
    case 'TICKET':
      // New ticket text makes yesterday's proposals stale; the impact stays until re-analysed.
      return { ...state, ticket: { ...state.ticket, ...action.ticket }, ...(action.ticket.body !== undefined && action.ticket.body !== state.ticket.body ? { proposals: null, proposalsStatus: 'idle', accepted: [] } : {}) };
    case 'TOGGLE_PICK':
      return { ...state, picked: toggle(state.picked, action.ref) };
    case 'PROPOSALS_LOADING':
      return { ...state, proposalsStatus: 'loading', proposalsError: null, accepted: [] };
    case 'PROPOSALS_LOADED':
      return { ...state, proposalsStatus: 'ready', proposals: action.proposals, accepted: [] };
    case 'PROPOSALS_FAILED':
      return { ...state, proposalsStatus: 'failed', proposals: null, proposalsError: action.error };
    case 'TOGGLE_ACCEPT':
      return { ...state, accepted: toggle(state.accepted, action.ref) };
    case 'IMPACT_LOADING':
      return { ...state, impactStatus: 'loading', impactError: null };
    case 'IMPACT_LOADED':
      return { ...state, impactStatus: 'ready', impact: action.impact, impactSeeds: action.seeds };
    case 'IMPACT_FAILED':
      return { ...state, impactStatus: 'failed', impactError: action.error };
    case 'STEPS':
      return { ...state, steps: action.steps, nextId: action.nextId, runStatus: 'idle', runError: null, runErrors: [], startedId: null, startedModels: [] };
    case 'VALIDATED':
      return { ...state, validation: action.validation, validatedFor: action.for };
    case 'RUN_LOADING':
      return { ...state, runStatus: 'loading', runError: null, runErrors: [] };
    case 'RUN_STARTED':
      return { ...state, runStatus: 'ready', startedId: action.processId, startedModels: action.models };
    case 'RUN_FAILED':
      return { ...state, runStatus: 'failed', runError: action.error, runErrors: action.errors };
    case 'NOTE_OPENED':
      return { ...state, ...screenFromNote(action.note), validation: null, validatedFor: null, runStatus: 'idle', runError: null, runErrors: [], startedId: null, startedModels: [], note: noteMeta(action.note), noteSave: { status: 'idle' } };
    case 'NOTE_SYNCED':
      return { ...state, note: noteMeta(action.note), noteSave: { status: 'saved' } };
    case 'NOTE_SAVING':
      return { ...state, noteSave: { status: 'saving' } };
    case 'NOTE_SAVE_FAILED':
      return { ...state, noteSave: { status: 'failed', message: action.message } };
    case 'NOTE_CONFLICT':
      return { ...state, noteSave: { status: 'conflict', theirs: action.theirs } };
    case 'NOTE_RETRY':
      return { ...state, noteSave: { status: 'idle' } };
    default:
      return state;
  }
}
