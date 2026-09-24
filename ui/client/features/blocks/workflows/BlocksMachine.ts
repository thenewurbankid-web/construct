// Pure (WORKFLOW-001): what the Blocks tab knows, and how each event changes it. No I/O.
//
// `blocks` is always a copy the SERVER confirmed: a toggle changes nothing on screen until the server says yes, so the
// card never shows a setting the server did not accept. A refusal keeps the previous copy and carries the server's
// plain sentence; a stale save (someone saved first) adopts the copy it lost to.
import type { BlocksData, ScreenAction, ScreenState } from '../domain/BlockTypes.ts';

export const initialScreen: ScreenState = {
  status: 'idle',
  error: null,
  rev: 0,
  unreadable: null,
  provider: 'ollama',
  blocks: [],
  filter: '',
  saving: null,
  refusal: null,
};

const adopt = (state: ScreenState, data: BlocksData): ScreenState => ({ ...state, status: 'ready', error: null, rev: data.rev, unreadable: data.unreadable, provider: data.provider, blocks: data.blocks });

export function screenReducer(state: ScreenState, action: ScreenAction): ScreenState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, status: state.status === 'ready' ? 'ready' : 'loading', error: null };
    case 'LOADED':
      return { ...adopt(state, action.data), refusal: null };
    case 'LOAD_FAILED':
      return { ...state, status: state.status === 'ready' ? 'ready' : 'failed', error: action.error };
    case 'FILTER':
      return { ...state, filter: action.text };
    case 'SAVE_START':
      return { ...state, saving: action.id ?? '*', refusal: null };
    case 'SAVED':
      return { ...adopt(state, action.data), saving: null, refusal: null };
    case 'SAVE_REFUSED':
      return { ...(action.current ? adopt(state, action.current) : state), saving: null, refusal: { id: action.id, code: action.code, message: action.message } };
    default:
      return state;
  }
}
