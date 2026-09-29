// Pure (WORKFLOW-001): #395/#772's "Save this flow" -- a name plus the draft's steps, previewed then
// committed. Same preview/Save/Cancel status shape as the Rules tab's edit reducers (RuleEdit.ts, GlobList.ts).
import type { SaveAction, SaveState } from '../types';

export const initialSave: SaveState = { status: 'idle', name: '', error: null };

export function saveReducer(state: SaveState, action: SaveAction): SaveState {
  switch (action.type) {
    case 'NAME':
      return { ...state, name: action.name, status: 'idle', error: null };
    case 'START':
      return { ...state, status: 'previewing', error: null };
    case 'PREVIEW_OK':
      return { ...state, status: 'ready' };
    case 'PREVIEW_FAIL':
      return { ...state, status: 'error', error: action.error };
    case 'SAVE':
      return { ...state, status: 'saving', error: null };
    case 'SAVE_OK':
      return { ...state, status: 'saved' };
    case 'SAVE_FAIL':
      return { ...state, status: 'error', error: action.error };
    case 'CANCEL':
      return { ...state, status: 'idle', error: null };
    case 'RESET':
      return initialSave;
    default:
      return state;
  }
}
