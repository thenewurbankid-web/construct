// The Import flow as a state machine: pick a folder -> scanning -> scanned (answer questions) -> planning -> planned ->
// applying -> applied. A refusal returns to the phase before the call with its sentence; changing the folder or an answer
// drops what was planned from the old one, so Apply always runs the plan the person sees.
import type { ImportEvent, ImportState } from '../types.ts';

export const initialImport: ImportState = { phase: 'pick', folders: null, folder: '', scan: null, answers: {}, plan: null, result: null, error: null };

const BEFORE: Record<string, ImportState['phase']> = { scanning: 'pick', planning: 'scanned', applying: 'planned' };

export function importReducer(state: ImportState, event: ImportEvent): ImportState {
  switch (event.type) {
    case 'FOLDERS':
      return { ...state, folders: event.folders };
    case 'SET_FOLDER':
      if (state.phase === 'scanning' || state.phase === 'planning' || state.phase === 'applying') return state;
      return { ...initialImport, folders: state.folders, folder: event.folder };
    case 'SCAN':
      return state.folder && (state.phase === 'pick' || state.phase === 'scanned' || state.phase === 'planned') ? { ...state, phase: 'scanning', error: null, plan: null, result: null } : state;
    case 'SCANNED':
      return state.phase === 'scanning' ? { ...state, phase: 'scanned', scan: event.scan, answers: {} } : state;
    case 'ANSWER':
      if (state.phase !== 'scanned' && state.phase !== 'planned') return state;
      return { ...state, phase: 'scanned', answers: { ...state.answers, [event.questionId]: event.optionId }, plan: null };
    case 'PLAN':
      return state.phase === 'scanned' ? { ...state, phase: 'planning', error: null } : state;
    case 'PLANNED':
      return state.phase === 'planning' ? { ...state, phase: 'planned', plan: event.plan } : state;
    case 'APPLY':
      return state.phase === 'planned' ? { ...state, phase: 'applying', error: null } : state;
    case 'APPLIED':
      return state.phase === 'applying' ? { ...state, phase: event.result.ok ? 'applied' : 'planned', result: event.result, error: event.result.ok ? null : event.result.sentence } : state;
    case 'REFUSED':
      return { ...state, phase: BEFORE[state.phase] ?? state.phase, error: event.sentence };
  }
}
