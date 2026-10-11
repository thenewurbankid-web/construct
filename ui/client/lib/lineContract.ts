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
/** cp1: Line actions as plan steps (contract.mjs PlanView). A check that defines a step's "done". */
export type PlanCheckKind = 'validate' | 'types' | 'tests' | 'file' | 'spec';
export type PlanCheck = { id: string; sentence: string; kind: PlanCheckKind };
/** Before a step runs: one expected output, already there or not. */
export type GapItem = { checkId: string; state: 'present' | 'partial' | 'missing'; sentence: string };
/** After a step runs: one check's outcome. */
export type CheckResult = { checkId: string; ok: boolean; sentence: string };
/** A `fix` comes from Construct's refusal (a finding's typed fix): `step` applies it, null for advice; rank 1 is `recommended`. */
export type StepOption = { id: 'retry' | 'leave' | 'fix'; sentence: string; fixId?: string; recommended?: boolean; step?: { tool: string; args: Record<string, unknown> } | null };
/** What a line.* change step records when it ran. */
export type LineStepResult = {
  apply: ApplyResult;
  checks: CheckResult[];
  passed: number;
  total: number;
  needsYou: boolean;
  options: StepOption[];
  stopped: boolean;
  sentence: string;
};
export type PlanStepState = 'waiting' | 'ready' | 'running' | 'done' | 'needs-you' | 'needs-fix' | 'failed' | 'skipped';
export type PlanStepView = {
  id: string;
  n: number;
  tool: string;
  args: Record<string, unknown>;
  why: string;
  kind: 'read' | 'write';
  state: PlanStepState;
  sentence: string;
  gap: GapItem[];
  result: LineStepResult | Record<string, unknown> | null;
  error: string | null;
};
/** GET /api/line/plan and every plan write. */
export type PlanView = {
  ok: true;
  sessionId: string;
  planId: string | null;
  version: number | null;
  status: string | null;
  steps: PlanStepView[];
  store: { linked: boolean; sentence: string };
  message?: string;
  /** POST /api/line/plan/step only: the step just added. */
  stepId?: string;
};
export type PlanStepRequest = { tool: string; args?: Record<string, unknown>; why?: string };

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
  getPlan: () => Promise<PlanView | LineRefusal>;
  addPlanStep: (req: PlanStepRequest) => Promise<PlanView | LineRefusal>;
  approvePlanStep: (stepId: string) => Promise<PlanView | LineRefusal>;
  runPlan: (stepId?: string) => Promise<PlanView | LineRefusal>;
  fix: (req: FixRequest) => Promise<ApplyResult | LineRefusal>;
  getFragments: (file: string) => Promise<FragmentList | LineRefusal>;
  setFragment: (req: SetFragmentRequest) => Promise<ApplyResult | LineRefusal>;
};

// ------------------------------------------------------------------------------------------------- Train Line
/** Train Line (packages/engine/line/train/contract.mjs, TRAIN_API under /api/line/train). Cases are stored with slots
 * ("<feature:F1>") instead of names; the server fills names back (`filled`) for the screen. */
export type TrainSlot = { type: string; ref?: string; kind?: string; role?: string; of?: string; rank?: number; fixId?: string; literal?: string | number | boolean };
export type TrainSlots = Record<string, TrainSlot>;
export type TrainStep = { tool: string; args: Record<string, unknown> };
export type TrainRoute = {
  id: string;
  label: string;
  scope: { layers: string[]; features: string[]; library: boolean };
  steps: TrainStep[];
  expect: unknown[];
  cost: number;
  risk: 'low' | 'medium' | 'high';
  outcome: 'change' | 'refusal' | 'question';
  question?: { about: string; sentence: string };
  refusal?: { code?: string; rule?: string };
  via?: string;
  confidence?: number;
};
/** A route with its names filled back. */
export type FilledRoute = {
  id: string;
  label: string;
  touches: string;
  steps: { tool: string; args: Record<string, unknown>; sentence: string }[];
  checks: string[];
  cost: number;
  risk: string;
  outcome: string;
  preferred: boolean;
  sentence?: string;
  via?: string;
  confidence?: number;
};
export type TrainCaseView = {
  id: string;
  intent: string;
  request: string;
  slots: TrainSlots;
  world: { kind: 'sample' } | { kind: 'corpus'; id: string; variant: string };
  split: 'train' | 'heldout';
  gold: { routes: TrainRoute[]; preferred: string };
  labelledBy: 'owner' | 'claude';
  status: 'draft' | 'agreed' | 'disputed';
  notes: { by: string; text: string; at: string }[];
  sample: boolean;
  filled: { request: string; intentPhrase: string; routes: FilledRoute[]; world: string; sentence?: string };
};
export type TrainCaseList = { total: number; open: number; cases: TrainCaseView[] };
export type TrainWorld = { key: string; label: string };
export type TrainUnknown = { word: string; choices: { ref: string; name: string }[] };
export type TrainDraft = {
  request: string;
  slots: TrainSlots;
  intent: string;
  intentPhrase: string;
  via: string;
  confidence: number;
  unknown: TrainUnknown[];
  routes: TrainRoute[];
  recommended: string | null;
  world: string;
  filled: { request: string; routes: FilledRoute[] };
  /** Each slot's current text (for typed values). */
  values: Record<string, string>;
  sentence?: string;
};
export type TrainChoices = {
  world: string;
  label: string;
  features: { ref: string; name: string }[];
  library: { ref: string; id: string; name: string; kind: string }[];
  items: { ref: string; id: string; name: string; kind: string; feature: string; file: string }[];
  findings: { ref: string; key: string; sentence: string; fixes: { id: string; sentence: string }[] }[];
  fragments: Record<string, { id: string; kind: string; label: string }[]>;
  tools: { name: string; label: string }[];
  intents: { id: string; phrase: string }[];
  map: { ref: string; type: string; name: string; words: string[]; synonyms: string[] }[];
  suggestions: string[];
};
export type TrainTry = { ok: boolean; sentence: string; steps: { sentence: string; ok: boolean }[]; checks: { sentence: string; ok: boolean }[] };
export type TrainPreview = { ok: boolean; request?: string; routes: FilledRoute[]; values?: Record<string, string>; sentence?: string };
export type ScoreRow = { cases: number; heldout: number; recall: number | null; precision: number | null; preferred: number | null; noRepair: number | null; sampled: number; agreed: number; disagreed: number; agreement: number | null; label?: string };
export type Scoreboard = { ok: true; lastRun: string | null; byFamily: Record<string, ScoreRow>; byIntent: Record<string, ScoreRow>; total: ScoreRow; sentence: string };
export type TrainSaveRequest = { world: string; request: string; intent: string; slots: TrainSlots; routes: TrainRoute[]; preferred: string; note?: string };

/** Every TRAIN_API route, as the client calls it (refusals come back as their sentence). */
export type TrainHttp = {
  worlds: () => Promise<{ worlds: TrainWorld[] } | LineRefusal>;
  cases: (filter: string, limit: number, offset?: number) => Promise<TrainCaseList | LineRefusal>;
  choices: (world: string) => Promise<TrainChoices | LineRefusal>;
  draft: (request: string, world: string) => Promise<TrainDraft | LineRefusal>;
  preview: (req: { world: string; request: string; slots: TrainSlots; routes: TrainRoute[]; preferred: string }) => Promise<TrainPreview | LineRefusal>;
  addRoute: (req: { world: string; slots: TrainSlots; tool: string; args: Record<string, unknown>; label?: string }) => Promise<{ slots: TrainSlots; route: TrainRoute } | LineRefusal>;
  tryRoute: (req: { world: string; slots: TrainSlots; route: TrainRoute }) => Promise<TrainTry | LineRefusal>;
  save: (req: TrainSaveRequest) => Promise<{ case: TrainCaseView } | LineRefusal>;
  review: (id: string, verdict: 'agree' | 'disagree', note?: string) => Promise<{ case: TrainCaseView } | LineRefusal>;
  synonym: (world: string, word: string, ref: string) => Promise<{ ok: true; sentence: string } | LineRefusal>;
  runEval: () => Promise<Scoreboard | LineRefusal>;
  scoreboard: () => Promise<Scoreboard | LineRefusal>;
};
