import type { PageTree } from '../types';

// Pure (WORKFLOW-001) — the pages browser/tree/selection state machine.
export type PagesEditorState = {
  features: string[];
  feature: string;
  files: string[];
  filesLoading: boolean;
  file: string;
  tree: PageTree | null;
  selectedNodeId: string | null;
  error: string | null;
};

export type PagesEditorAction =
  | { type: 'FEATURES_LOADED'; features: string[] }
  | { type: 'SET_FEATURE'; feature: string }
  | { type: 'FILES_LOADED'; files: string[] }
  | { type: 'OPEN_FILE'; file: string }
  | { type: 'TREE_LOADED'; tree: PageTree }
  | { type: 'TREE_ERROR'; error: string }
  | { type: 'SELECT_NODE'; nodeId: string }
  | { type: 'TREE_UPDATED'; tree: PageTree };

export const initialPagesEditorState: PagesEditorState = {
  features: [],
  feature: '',
  files: [],
  filesLoading: false,
  file: '',
  tree: null,
  selectedNodeId: null,
  error: null,
};

export function pagesEditorReducer(state: PagesEditorState, action: PagesEditorAction): PagesEditorState {
  switch (action.type) {
    case 'FEATURES_LOADED':
      return { ...state, features: action.features };
    case 'SET_FEATURE':
      return {
        ...state,
        feature: action.feature,
        file: '',
        tree: null,
        selectedNodeId: null,
        files: action.feature ? state.files : [],
        filesLoading: Boolean(action.feature),
      };
    case 'FILES_LOADED':
      return { ...state, files: action.files, filesLoading: false };
    case 'OPEN_FILE':
      return { ...state, file: action.file, selectedNodeId: null, error: null, tree: null };
    case 'TREE_LOADED':
      return { ...state, tree: action.tree, error: null };
    case 'TREE_ERROR':
      return { ...state, error: action.error };
    case 'SELECT_NODE':
      return { ...state, selectedNodeId: action.nodeId };
    case 'TREE_UPDATED':
      return { ...state, tree: action.tree };
    default:
      return state;
  }
}
