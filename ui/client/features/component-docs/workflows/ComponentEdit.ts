// Pure (WORKFLOW-001): the plain-file edit flow of the Components screen. Edit the text -> Review changes (the server
// returns the diff, nothing written) -> Confirm save (hash-checked, architecture-gated, then written). Every step that
// can fail says so in words and leaves the draft alone, so nothing typed is ever lost to an error.
import type { EditAction, EditState } from '../types.ts';

export const initialEditState: EditState = { loaded: null, draft: '', phase: 'clean', hunks: [], error: null, saved: false, conflict: false };

export const isDirty = (s: EditState): boolean => s.loaded !== null && s.draft !== s.loaded.source;

export function editReducer(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case 'LOAD':
      return { ...initialEditState, loaded: action.loaded, draft: action.loaded.source };
    case 'EDIT': {
      if (!state.loaded || !state.loaded.editable || state.phase === 'saving' || state.phase === 'checking') return state;
      return { ...state, draft: action.draft, phase: action.draft === state.loaded.source ? 'clean' : 'dirty', hunks: [], error: null, saved: false };
    }
    case 'CHECKING':
      return { ...state, phase: 'checking', error: null };
    case 'PREVIEW':
      return { ...state, phase: 'preview', hunks: action.hunks, error: null };
    case 'CANCEL_PREVIEW':
      return { ...state, phase: isDirty(state) ? 'dirty' : 'clean', hunks: [] };
    case 'SAVING':
      return { ...state, phase: 'saving', error: null };
    case 'SAVED':
      return state.loaded
        ? { ...state, loaded: { ...state.loaded, source: state.draft, contentHash: action.contentHash }, phase: 'clean', hunks: [], error: null, saved: true, conflict: false }
        : state;
    case 'FAILED':
      return { ...state, phase: isDirty(state) ? 'dirty' : 'clean', hunks: [], error: action.error, conflict: action.conflict === true };
    case 'DISCARD':
      return state.loaded ? { ...initialEditState, loaded: state.loaded, draft: state.loaded.source } : state;
    default:
      return state;
  }
}
