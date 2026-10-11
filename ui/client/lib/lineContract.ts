// The client's one typed mirror of the Line Cockpit contract (packages/engine/line/contract.mjs): the shapes every
// /api/line route answers or takes. The contract is the source of truth: change a shape there first, then here.
// Every Line screen (line-library, line-pages, line-render) reads these from here, never its own copy. It lives in lib/ because
// ui/client/architecture.yml keeps features from sharing code except through lib/ (a slice needs every layer folder).

export type LineKind = 'components' | 'pages' | 'workflows' | 'fixtures';
export type Level = 'atom' | 'molecule' | 'organism';

/** One finding: the plain-English sentence first, the technical part separate (for a collapsed Details). */
export type LineFinding = { sentence: string; rule: string; severity: 'error' | 'warning' | 'info'; file: string; line: number };

/** A library item (complete and usable on its own). */
export type LibraryItem = {
  id: string;
  kind: LineKind;
  name: string;
  file: string;
  /** Components only. */
  level?: Level;
  usedBy: { feature: string; file: string }[];
};

/** A feature item (based on exactly one library item, owned by one feature). */
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

/** GET /api/line/project. */
export type LineProject = {
  isLine: boolean;
  layout: { library: string; features: string; state: string };
  library: LibraryItem[];
  features: LineFeature[];
  findings: LineFinding[];
};

/** The outcome of a change through Construct's writer; a refusal is `ok: false` with one sentence. */
export type ApplyResult = { ok: boolean; sentence: string; files: string[]; findings: LineFinding[] };

/** A LineOpError as the server sends it (HTTP 400). */
export type LineRefusal = { ok: false; sentence: string; code: string };

export type BaseOnRequest = { libraryId: string; feature: string; name: string };
export type PromoteRequest = { featureItemId: string };
export type PropValueKind = 'string' | 'number' | 'boolean' | 'expression';
export type SetPropRequest = { file: string; nodeId: string; prop: string; kind: PropValueKind; value: string | number | boolean };

/** GET /api/line/page-tree?file=: a page's element tree (pageProp.mjs readPageTree). Node ids ("n0", "n1", ...) go
 * straight into SetPropRequest.nodeId; they can shift after a save, so read the tree again after every save. */
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

/** GET /api/line/render: one prop of the rendered component (its type as written, the kind it is edited as, the value). */
export type RenderPropKind = 'string' | 'number' | 'boolean' | 'other';
export type RenderProp = { name: string; type: string; kind: RenderPropKind; value: unknown };
export type RenderResult =
  | { ok: true; html: string; props: RenderProp[]; via: 'morpheus' | 'construct-preview' }
  | { ok: false; code: string; sentence: string; detail?: string; props?: RenderProp[] };

/** GET /api/line/feature?name=: one feature for the Features screen (feature.mjs readLineFeature). The summary is
 * written by static rules (no model); a spec point is covered when it names a feature item or a test title. */
export type SpecPoint = { id: string; text: string; covered: boolean; by: string[] };
export type SpecStory = { id: string; text: string; points: SpecPoint[] };
export type LineFeatureDetail = {
  name: string;
  items: Record<LineKind, FeatureItem[]>;
  summary: { sentences: string[]; via: 'static' };
  spec: { file: string; stories: SpecStory[] } | null;
  findings: LineFinding[];
};

/** Every LINE_API route, as the client calls it. Bodies come back as the server sent them, refusals included; each
 * screen turns them into what it shows. A network failure rejects. */
export type LineHttp = {
  getProject: () => Promise<LineProject | LineRefusal>;
  getPageTree: (file: string) => Promise<LinePageTree | LineRefusal>;
  setPageProp: (req: SetPropRequest) => Promise<ApplyResult | LineRefusal>;
  baseOn: (req: BaseOnRequest) => Promise<ApplyResult | LineRefusal>;
  promote: (req: PromoteRequest) => Promise<ApplyResult | LineRefusal>;
  render: (file: string, props?: string) => Promise<RenderResult>;
  getFeature: (name: string) => Promise<LineFeatureDetail | LineRefusal>;
};
