// Shapes for the Browser pane's Flow view (#328). The tree is `sections.flow` from `construct summarize`,
// as served by GET /api/flow/:feature; every path in it is project-root-relative.

export type BrowserView = 'files' | 'flow';

/** One file in a flow tree (see schemas/unit-summary.v1.json `flowNode`). */
export type FlowNode = {
  file: string;
  layer: string;
  /** Present only when the file belongs to a different feature than the one the tree is for. */
  feature?: string;
  /** Already drawn earlier in the same route tree; carries no children there. */
  shownAbove?: true;
  children?: FlowNode[];
};

export type FlowController = {
  file: string;
  layer?: 'controller';
  behaviour?: FlowNode[];
  render?: FlowNode[];
  other?: FlowNode[];
};

export type FlowRouteFeature = { feature: string; self: boolean; ref: string; controllers: FlowController[] };

export type FlowRoute = { route: string; file: string; fanOut: boolean; features: FlowRouteFeature[] };

export type FlowNote = { severity: string; code: string; message: string };

/** What the server returns for one feature. */
export type FlowData = {
  ok: true;
  feature: string;
  framework: string;
  routeAdapter: boolean;
  routes: FlowRoute[];
  notes: FlowNote[];
};

export type FlowRowKind = 'route' | 'controller' | 'branch' | 'node';

/** One drawn line of the tree. `file` is null for a branch heading. */
export type FlowRow = {
  id: string;
  kind: FlowRowKind;
  depth: number;
  parentId: string | null;
  label: string;
  layer: string;
  file: string | null;
  /** The feature this file belongs to (the tree's own feature unless the file crosses over). */
  feature: string | null;
  shownAbove: boolean;
  /** A file from a different feature than the controller it sits under (e.g. a shared component). */
  foreign: boolean;
  hasChildren: boolean;
  /** How many rows sit beneath a branch heading, or how many features a route fans out to. */
  count: number;
};

export type Relation = 'uses' | 'usedBy';

export type FlowLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: FlowData };

export type FlowBrowserState = {
  load: FlowLoadState;
  selectedId: string | null;
  collapsed: string[];
};

export type FlowBrowserAction =
  | { type: 'LOADING' }
  | { type: 'LOADED'; data: FlowData }
  | { type: 'FAILED'; message: string }
  | { type: 'SELECT'; id: string }
  | { type: 'TOGGLE'; id: string };

/** Everything the tooltip says about a row. */
export type FlowHint = { relation: string; sentence: string; path: string | null };

/** The row under the pointer (or focus): what to say about it and where to draw it. */
export type FlowHover = { row: FlowRow; hint: FlowHint; x: number; y: number };

/** Everything the Flow view draws, as the hook hands it to the page. */
export type FlowBrowserView = {
  load: FlowLoadState;
  data: FlowData | null;
  shown: FlowRow[];
  selectedId: string | null;
  collapsed: string[];
  relations: Map<string, Relation>;
  hover: FlowHover | null;
  select: (id: string) => void;
  toggle: (id: string) => void;
  showHint: (row: FlowRow, el: HTMLElement) => void;
  hideHint: () => void;
};
