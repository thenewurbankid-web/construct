// Workflow (no React, WORKFLOW-001): the layout state machine. Every change
// goes through the reducer, so sizes are always clamped to the pane limits.
import type { ShellLayoutAction, ShellLayoutState } from '../types.ts';
import { DEFAULT_LAYOUT, PANE_LIMITS } from '../domain/LayoutDefaults.ts';
import { clampSize } from '../domain/PaneSizing.ts';

export const initialShellLayout: ShellLayoutState = DEFAULT_LAYOUT;

export function shellLayoutReducer(state: ShellLayoutState, action: ShellLayoutAction): ShellLayoutState {
  switch (action.type) {
    case 'LOAD':
      return action.layout;
    case 'RESIZE': {
      const { min, max } = PANE_LIMITS[action.pane];
      const size = clampSize(action.size, min, max);
      if (size === state[action.pane].size) return state;
      return { ...state, [action.pane]: { ...state[action.pane], size } };
    }
    case 'TOGGLE': {
      const open = action.open ?? !state[action.pane].open;
      if (open === state[action.pane].open) return state;
      return { ...state, [action.pane]: { ...state[action.pane], open } };
    }
    default:
      return state;
  }
}
