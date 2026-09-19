// Pure (WORKFLOW-001): the palette's query and highlighted row.
import { moveActive } from '../domain/PaletteKeys.ts';

export type PaletteState = { query: string; activeIndex: number };

export type PaletteAction =
  | { type: 'RESET' }
  | { type: 'QUERY'; query: string }
  | { type: 'SET_ACTIVE'; index: number }
  | { type: 'MOVE'; key: string; count: number };

export const initialPalette: PaletteState = { query: '', activeIndex: 0 };

export function paletteReducer(state: PaletteState, action: PaletteAction): PaletteState {
  switch (action.type) {
    case 'RESET':
      return initialPalette;
    case 'QUERY':
      return { query: action.query, activeIndex: 0 }; // a new search starts at the top
    case 'SET_ACTIVE':
      return state.activeIndex === action.index ? state : { ...state, activeIndex: action.index };
    case 'MOVE':
      return { ...state, activeIndex: moveActive(state.activeIndex, action.count, action.key) };
    default:
      return state;
  }
}
