// A typed mirror of the Line Cockpit contract (packages/engine/line/contract.mjs), the part the Pages screen uses.
// The contract is the source of truth: change a shape there first, then here.

export type LineKind = 'components' | 'pages' | 'workflows' | 'fixtures';

/** One finding: the sentence first, the technical part separate (for a collapsed Details). */
export type LineFinding = {
  sentence: string;
  rule: string;
  severity: 'error' | 'warning' | 'info';
  file: string;
  line: number;
};

export type LibraryItem = {
  id: string;
  kind: LineKind;
  name: string;
  file: string;
  level?: 'atom' | 'molecule' | 'organism';
  usedBy: { feature: string; file: string }[];
};

export type FeatureItem = {
  id: string;
  kind: LineKind;
  name: string;
  feature: string;
  file: string;
  base: { value: string | null; libraryId: string | null };
  status: 'ok' | 'problem';
  findings: LineFinding[];
};

export type LineFeature = { name: string; spec: string | null; items: FeatureItem[] };

export type LineProject = {
  isLine: boolean;
  layout: { library: string; features: string; state: string };
  library: LibraryItem[];
  features: LineFeature[];
  findings: LineFinding[];
};

export type PropValueKind = 'string' | 'number' | 'boolean' | 'expression';

export type SetPropRequest = { file: string; nodeId: string; prop: string; kind: PropValueKind; value: string | number | boolean };

export type ApplyResult = { ok: boolean; sentence: string; files: string[]; findings: LineFinding[] };

/** A LineOpError as the server sends it (HTTP 400). */
export type LineRefusal = { ok: false; sentence: string; code: string };

/** A page's element tree, as GET /api/line/page-tree?file=<root-relative path> serves it (packages/engine/line/
 * pageProp.mjs readPageTree). Node ids ("n0", "n1", ...) go straight into SetPropRequest.nodeId; they can shift
 * after a save, so the screen reads the tree again after every save. */
export type PageNodeProp = {
  kind: 'string' | 'number' | 'boolean' | 'identifier' | 'expression' | 'spread';
  name: string | null;
  value: unknown;
  index: number;
};
export type LinePageNode = {
  id: string;
  tag: string;
  isFragment: boolean;
  isCustomComponent: boolean;
  props: PageNodeProp[];
  /** False for fragments: nothing on them can be set. */
  settable: boolean;
  line: number;
  column: number;
  children: LinePageNode[];
};
export type LinePageTree = { file: string; feature: string; contentHash: string; scopeNames: string[]; roots: LinePageNode[] };

/** One editable prop of a part. */
export type PartProp = { name: string; kind: Exclude<PropValueKind, 'expression'>; value: string | number | boolean };

/** One part of a page: an element and the props a person can change without code. */
export type PagePart = { nodeId: string; tag: string; depth: number; props: PartProp[] };

/** A page row on the screen. */
export type PageRow = {
  id: string;
  name: string;
  file: string;
  status: 'ok' | 'problem';
  /** "Based on ListPage", or a plain-English problem when the base is missing or broken. */
  base: { ok: boolean; text: string };
  findings: LineFinding[];
};

/** The outcome of a Save, as the screen shows it. */
export type SaveOutcome = { ok: boolean; sentence: string; findings: LineFinding[] };

/** The chosen page's parts, as the screen loads them. */
export type PartsState = { phase: 'idle' } | { phase: 'loading' } | { phase: 'ready'; parts: PagePart[] } | { phase: 'error'; sentence: string };

/** Everything the Line Pages screen renders and does (built by useLinePages). */
export type LinePagesView = {
  features: { name: string; summary: string }[];
  feature: string | null;
  chooseFeature: (name: string | null) => void;
  pages: PageRow[];
  page: FeatureItem | null;
  choosePage: (id: string | null) => void;
  parts: PartsState;
  save: (part: PagePart, prop: PartProp, raw: string | boolean) => void;
  saving: boolean;
  revision: number;
  outcome: SaveOutcome | null;
};

/** Everything the Line Pages API offers the screen (real server or the contract's mock). */
export type LinePagesApi = {
  getProject: () => Promise<LineProject>;
  getPageTree: (file: string) => Promise<LinePageTree>;
  setPageProp: (req: SetPropRequest) => Promise<ApplyResult | LineRefusal>;
};
