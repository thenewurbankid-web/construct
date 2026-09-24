// Pure (WORKFLOW-001): what the Notes screen knows, and how each event changes it. No I/O.
//
// The rule that makes autosave safe: `note` is the last copy the SERVER confirmed, `draft` is what is in the page.
// They differ exactly while there is something unsaved. A save never overwrites what was typed after it started
// (SAVE_OK keeps the newer draft), and a conflict never overwrites anything until a person chooses (Keep mine /
// Load theirs).
import { byRecent, draftOf, rowOf, sameDraft } from '../domain/NoteDraft.ts';
import type { ScreenAction, ScreenState } from '../domain/NoteTypes.ts';

export const initialScreen: ScreenState = {
  list: { status: 'idle', rows: [], error: null },
  note: null,
  draft: { title: '', body: '' },
  save: { status: 'idle' },
  comparing: false,
  confirmingDelete: false,
  openError: null,
};

export function screenReducer(state: ScreenState, action: ScreenAction): ScreenState {
  switch (action.type) {
    case 'LIST_LOADING':
      return { ...state, list: { ...state.list, status: 'loading', error: null } };
    case 'LIST_LOADED':
      return { ...state, list: { status: 'ready', rows: action.rows, error: null } };
    case 'LIST_FAILED':
      return { ...state, list: { ...state.list, status: 'failed', error: action.error } };
    case 'LIST_UPSERT': {
      const rows = state.list.rows.filter((r) => r.id !== action.row.id);
      return { ...state, list: { ...state.list, rows: byRecent([action.row, ...rows]) } };
    }
    case 'LIST_REMOVE':
      return { ...state, list: { ...state.list, rows: state.list.rows.filter((r) => r.id !== action.id) } };
    case 'OPENED':
      return { ...state, note: action.note, draft: draftOf(action.note), save: { status: 'saved', at: action.note.updatedAt }, comparing: false, confirmingDelete: false, openError: null };
    case 'OPEN_FAILED':
      return { ...state, note: null, draft: { title: '', body: '' }, save: { status: 'idle' }, comparing: false, confirmingDelete: false, openError: action.error };
    case 'CLOSED':
      return { ...state, note: null, draft: { title: '', body: '' }, save: { status: 'idle' }, comparing: false, confirmingDelete: false, openError: null };
    case 'EDIT': {
      if (state.note === null) return state;
      const draft = { ...state.draft, ...action.edit };
      // Typing after "Saved" makes the indicator honest again; a failure or a conflict stays until it is dealt with.
      return { ...state, draft, save: state.save.status === 'saved' ? { status: 'idle' } : state.save };
    }
    case 'SAVE_STARTED':
      return { ...state, save: { status: 'saving' } };
    case 'SAVE_OK':
      // Text typed while the request was in flight stays in the page; only the confirmed copy moves on.
      return { ...state, note: action.note, save: sameDraft(state.draft, action.sent) ? { status: 'saved', at: action.note.updatedAt } : { status: 'idle' } };
    case 'SAVE_CONFLICT':
      // The other tab saved the very same text: nothing to choose between, the note is simply saved.
      if (sameDraft(state.draft, draftOf(action.theirs))) return { ...state, note: action.theirs, save: { status: 'saved', at: action.theirs.updatedAt } };
      return { ...state, save: { status: 'conflict', theirs: action.theirs } };
    case 'SAVE_FAILED':
      return { ...state, save: { status: 'failed', message: action.message, code: action.code } };
    case 'KEEP_MINE':
      // Their copy becomes the base (its rev), my text stays in the page, and the next save is made against it.
      if (state.save.status !== 'conflict') return state;
      return { ...state, note: state.save.theirs, save: { status: 'idle' }, comparing: false };
    case 'LOAD_THEIRS':
      if (state.save.status !== 'conflict') return state;
      return { ...state, note: state.save.theirs, draft: draftOf(state.save.theirs), save: { status: 'saved', at: state.save.theirs.updatedAt }, comparing: false };
    case 'TOGGLE_COMPARE':
      return state.save.status === 'conflict' ? { ...state, comparing: !state.comparing } : state;
    case 'CONFIRM_DELETE':
      return { ...state, confirmingDelete: action.on };
    default:
      return state;
  }
}

/** The list row to show for the open note, with the page's unsaved text (so the list follows typing). */
export const openRow = (state: ScreenState) => (state.note ? rowOf({ ...state.note, ...state.draft }) : null);
