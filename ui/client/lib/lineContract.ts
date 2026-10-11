// The client's one typed mirror of the Line Cockpit contract (packages/engine/line/contract.mjs): the shapes every
// /api/line route answers or takes. The contract is the source of truth: change a shape there first, then here.
// Every Line screen (line-library, line-pages, line-render) reads these from here, never its own copy. It lives in lib/ because
// ui/client/architecture.yml keeps features from sharing code except through lib/ (a slice needs every layer folder).

export type LineKind = 'components' | 'pages' | 'workflows' | 'fixtures';
export type Level = 'atom' | 'molecule' | 'organism';

/** One finding: the plain-English sentence first, the technical part separate (for a collapsed Details). */
export type LineFinding = {
  sentence: string;
  rule: string;
  severity: 'error' | 'warning' | 'info';
  file: string;
  line: number;
  /** "<rule>|<file>|<line>": the handle POST /api/line/fix takes. */
  key?: string;
  /** Typed fixes, recommended first (rank 1); LINE-* findings only. */
  fixes?: LineFix[];
};

/** The Line tools a fix step calls; each is a planner whose change goes through Construct's writer. */
export type LineFixTool = 'line.setBase' | 'line.promote' | 'line.baseOn' | 'line.moveFile' | 'line.createLayout';

/** One typed fix: what it will do, in plain English, and the plan step; `step` is null when it is advice only. */
export type LineFix = {
  id: string;
  sentence: string;
  rank: number;
  step: { tool: LineFixTool; args: Record<string, unknown> } | null;
};

/** POST /api/line/fix. */
export type FixRequest = { findingKey: string; fixId: string };

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
export type ApplyResult = { ok: boolean; sentence: string; files: string[]; findings: LineFinding[]; code?: string };

/** GET/POST /api/line/workspace (cu6): the one folder of the project Line may change ('' = the whole project);
 * everything outside it is read-only, and a change touching it is refused with code OUTSIDE_WORKSPACE. */
export type LineWorkspace = { root: string; folder: string; readOnly: true };
export type WorkspaceRequest = { folder: string };

/** A LineOpError as the server sends it (HTTP 400); `detail` is the technical reason (a parser or type message) for Details. */
export type LineRefusal = { ok: false; sentence: string; code: string; detail?: string };

/** cx1: one fragment of code a person edits in place (a prop's value, a handler, a condition, a style value). */
export type FragmentKind = 'prop-expression' | 'handler' | 'condition' | 'style';
export type CodeFragment = {
  /** Stable for the source it came from; pass it to SetFragmentRequest.fragmentId. */
  id: string;
  file: string;
  kind: FragmentKind;
  /** Plain English, e.g. "What happens when Save is clicked". */
  label: string;
  code: string;
  range: { start: number; end: number };
  contentHash: string;
  /** The page-tree part it sits on ("n0", ...). */
  nodeId: string;
};
/** GET /api/line/fragments?file=. */
export type FragmentList = { file: string; contentHash: string; fragments: CodeFragment[] };
/** POST /api/line/fragment. */
export type SetFragmentRequest = { file: string; fragmentId: string; code: string; contentHash: string };

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
  getWorkspace: () => Promise<LineWorkspace | LineRefusal>;
  setWorkspace: (req: WorkspaceRequest) => Promise<LineWorkspace | LineRefusal>;
  fix: (req: FixRequest) => Promise<ApplyResult | LineRefusal>;
  getFragments: (file: string) => Promise<FragmentList | LineRefusal>;
  setFragment: (req: SetFragmentRequest) => Promise<ApplyResult | LineRefusal>;
  getAiProfiles: () => Promise<AiProfiles | LineRefusal>;
};

/** cu2: one AI step's profile (Cockpit, Trace and Construct steps are one set; contract.mjs StepProfile). */
export type StepProfile = {
  step: string;
  label: string;
  kind: 'decide' | 'draft';
  provider: 'ollama' | 'hosted';
  model: string | null;
  modelFrom: string;
  maxTokens: number;
  fallback: 'static';
  ladder: {
    static: { target: number };
    options: { on: boolean; target: number };
    review: { on: boolean; target: number };
    measured: string | null;
  };
  source: 'cockpit' | 'trace' | 'construct';
};

/** cu2: GET /api/line/ai-profiles. */
export type AiProfiles = {
  defaultModel: string;
  profiles: StepProfile[];
  reason: { linked: boolean; sentence: string };
};
