// Pure (WORKFLOW-001): what the Flow view knows (load state, the selected row, collapsed rows) and how each
// event changes it.
import type { FlowBrowserAction, FlowBrowserState } from '../types.ts';

export const initialFlowBrowser: FlowBrowserState = { load: { status: 'idle' }, selectedId: null, collapsed: [] };

export function flowBrowserReducer(state: FlowBrowserState, action: FlowBrowserAction): FlowBrowserState {
  switch (action.type) {
    case 'LOADING':
      return { load: { status: 'loading' }, selectedId: null, collapsed: [] };
    case 'LOADED':
      return { ...state, load: { status: 'ready', data: action.data } };
    case 'FAILED':
      return { ...state, load: { status: 'error', message: action.message } };
    case 'SELECT':
      return { ...state, selectedId: state.selectedId === action.id ? null : action.id };
    case 'TOGGLE':
      return { ...state, collapsed: state.collapsed.includes(action.id) ? state.collapsed.filter((c) => c !== action.id) : [...state.collapsed, action.id] };
    default:
      return state;
  }
}
