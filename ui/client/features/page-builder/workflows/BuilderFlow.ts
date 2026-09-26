// The builder screen's own state (#679): the page name, the export panel and the last status line. A plain reducer,
// pure, so every transition is testable without a browser.

export type BuilderState = {
  name: string;
  /** The exported TSX while the export panel is open, null when it is closed. */
  exported: string | null;
  status: string;
};

export type BuilderAction =
  | { type: 'RENAMED'; name: string }
  | { type: 'EXPORTED'; tsx: string }
  | { type: 'EXPORT_CLOSED' }
  | { type: 'STATUS'; status: string };

export const initialBuilder: BuilderState = { name: 'Demo', exported: null, status: '' };

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'RENAMED':
      return { ...state, name: action.name };
    case 'EXPORTED':
      return { ...state, exported: action.tsx, status: '' };
    case 'EXPORT_CLOSED':
      return { ...state, exported: null };
    case 'STATUS':
      return { ...state, status: action.status };
    default:
      return state;
  }
}
