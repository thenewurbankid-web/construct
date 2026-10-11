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
  /** "<rule>|<file>|<line>": the handle a line.fix plan step takes. */
  key?: string;
  /** Typed fixes, recommended first (rank 1); LINE-* findings only. */
  fixes?: LineFix[];
};

/** The Line tools a fix step calls; each is a planner whose change goes through Construct's writer. */
export type LineFixTool = 'line.setBase' | 'line.promote' | 'line.baseOn' | 'line.moveFile' | 'line.createLayout' | 'line.amend';

/** One typed fix: what it will do, in plain English, and the plan step; `step` is null when it is advice only. */
export type LineFix = {
  id: string;
  sentence: string;
  rank: number;
  step: { tool: LineFixTool; args: Record<string, unknown> } | null;
};

/** The args of a line.fix plan step. */
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

/** POST /api/line/new-project (cu7): `parentDir` is a folder of the workspace ("" is the workspace itself). */
export type NewLineProjectRequest = { parentDir: string; name: string; firstFeature: string };
/** The starter files' ApplyResult, the new folder (null when refused) and, once opened, the settings of the open project. */
export type NewLineProjectResult = ApplyResult & { dir: string | null; project?: { projectDir?: string | null } };

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
  /** cs1: the step as the summarizer says it (plain sentences first, the technical part as details). */
  plain?: PlainSummary;
};
/** cs1 (packages/summarize/contract.mjs Summary): plain-English sentences that pass checkSentence, and the technical
 * part (tool call, ids, options with confidence, reasoning, code) shown under a collapsed Details by <PlainFirst>. */
export type SummaryDetail = { label: string; text: string };
export type PlainSummary = { sentences: string[]; details: SummaryDetail[]; via: 'static' };
/** One technical line under <PlainFirst>'s Details; `testId` lets a screen keep its own handle on it. */
export type PlainDetail = SummaryDetail & { testId?: string };
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
  /** POST /api/line/plan/run after a fix step landed: the step it fixed plans clean again (waits for approval) or not. */
  recheck?: string;
  /** GET /api/line/plan only: the token the page sends back as x-line-approval to approve or run (only a person does). */
  approvalToken?: string;
};
export type PlanStepRequest = { tool: string; args?: Record<string, unknown>; why?: string };
/** Import (ci1): one folder of the open project brought into Line; only that folder is ever written. */
export type ImportTarget = 'library' | 'feature';
export type ImportFound = {
  file: string;
  kind: LineKind;
  name: string;
  proposal: { target: ImportTarget; feature?: string; base?: string; level?: Level; route?: string; sentence: string };
  confidence: 'sure' | 'ask';
  rules: string[];
  usedBy: string[];
};
export type ImportQuestion = { id: string; file: string; sentence: string; options: { id: string; sentence: string }[]; recommended: string };
/** POST /api/line/import/scan. */
export type ImportScan = {
  sourceRoot: string;
  folder: string;
  found: ImportFound[];
  questions: ImportQuestion[];
  unchanged: { file: string; sentence: string }[];
  routes: string[];
};
export type ImportStepTool = 'line.import.mark' | 'line.import.toLibrary' | 'line.import.toFeature';
export type ImportStep = { id: string; tool: ImportStepTool; args: Record<string, unknown>; sentence: string };
/** POST /api/line/import/plan. */
export type ImportPlan = { folder: string; summary: string; steps: ImportStep[] };
/** POST /api/line/import/apply: an ApplyResult plus how each step went. */
export type ImportApplyResult = ApplyResult & { steps: { id: string; ok: boolean; sentence: string }[] };
export type ImportFolders = { sourceRoot: string; folders: { path: string; files: number }[] };
export type ImportScanRequest = { folder: string };
export type ImportPlanRequest = { folder: string; answers: Record<string, string> };

/** cw1: Line workflows, state machines between pages (contract.mjs LineWorkflow, workflows.mjs). */
export type LineWorkflowAction = { kind: 'callService'; service: string } | { kind: 'setPartState'; part: string; state: string } | { kind: 'other'; name: string };
/** A role: a state a page fills (`page` is the feature page's name, null when not chosen; always null in the library). */
export type LineWorkflowRole = { id: string; says: string; page: string | null; pageOk: boolean };
export type LineWorkflowState = { id: string; label: string; role: string | null; page: string | null; initial: boolean; final: boolean };
/** One transition as a When -> Do card. Only the feature's own (`origin: 'feature'`) can be removed. */
export type LineWorkflowTransition = {
  id: string;
  from: string;
  event: string;
  to: string | null;
  actions: LineWorkflowAction[];
  origin: 'library' | 'feature';
  removable: boolean;
  when: string;
  do: string;
};
export type LineWorkflow = {
  id: string;
  kind: 'library' | 'feature';
  name: string;
  file: string;
  feature: string | null;
  base: { value: string | null; libraryId: string | null } | null;
  machineId: string;
  initial: string | null;
  roles: LineWorkflowRole[];
  states: LineWorkflowState[];
  transitions: LineWorkflowTransition[];
  summary: string[];
  usedBy: { feature: string; file: string }[];
};
/** GET /api/line/workflows?feature= */
export type LineWorkflowList = { feature: string; workflows: LineWorkflow[]; library: LineWorkflow[]; pages: string[]; notMachines: { id: string; file: string; sentence: string }[] };
/** The workflow plan tools' arguments (each is a write step a person approves in the Plan panel). */
export type BaseWorkflowOnRequest = { libraryId: string; feature: string; name: string };
export type SetWorkflowRoleRequest = { file: string; role: string; page: string };
export type AddWorkflowTransitionRequest = { file: string; from: string; event: string; to: string; service?: string; part?: string; partState?: string };
export type RemoveWorkflowTransitionRequest = { file: string; from: string; event: string };
/** cu3: one tool of the one registry (contract.mjs ToolView). A `project` write only ever becomes a plan step; a `line`
 * write (Line's own state) runs at once and is logged. `controlId` names the Cockpit control that does the same. */
export type ToolSurfaces = { http?: { method: 'GET' | 'POST'; path: string }; mcp?: string; plan?: boolean; gatelm?: boolean; studio?: boolean };
export type ToolView = {
  id: string;
  kind: 'read' | 'write';
  writes: 'project' | 'line' | null;
  sentence: string;
  outputSchema: string;
  inputFields: string[];
  controlId?: string;
  personOnly?: boolean;
  surfaces: ToolSurfaces;
};
/** GET /api/line/tools. */
export type ToolList = { ok: true; tools: ToolView[] };

/** cg1/ct1: Trace (contract.mjs LineControl, AutoAction, TraceMatch). One control registry; the DOM carries
 * data-line-control (and data-line-target for the item a control acts on). */
export type LineScreen = 'components' | 'pages' | 'features' | 'plan';
export type LineControl = { controlId: string; toolId: string; screen: LineScreen; label: string };
export type AutoAction = { kind: 'click' | 'type' | 'select' | 'approve'; controlId: string; target: string | null; value?: string; caption: string };
export type TraceTool = {
  toolId: string;
  from: 'request' | 'step';
  stepId: string | null;
  args: Record<string, unknown>;
  sentence: string;
  controls: { controlId: string; target: string | null; screen: LineScreen; label: string }[];
  script: AutoAction[];
  missing: string | null;
};
export type TraceRequest = { request?: string; steps?: { id: string; n?: number; tool: string; state: string }[] };
export type TraceMatch = {
  ok: true;
  request: string;
  tools: TraceTool[];
  alternatives: string[];
  choice: { options: string[]; picked: string; via: 'static' | 'jev'; sentence: string } | null;
  via: 'static' | 'jev';
  sentence: string;
};

/** Every LINE_API route, as the client calls it. Bodies come back as the server sent them, refusals included; each
 * screen turns them into what it shows. A network failure rejects. */
export type LineHttp = {
  getProject: () => Promise<LineProject | LineRefusal>;
  getPageTree: (file: string) => Promise<LinePageTree | LineRefusal>;
  render: (file: string, props?: string) => Promise<RenderResult>;
  getFeature: (name: string) => Promise<LineFeatureDetail | LineRefusal>;
  getWorkspace: () => Promise<LineWorkspace | LineRefusal>;
  getWorkflows: (feature: string) => Promise<LineWorkflowList | LineRefusal>;
  setWorkspace: (req: WorkspaceRequest) => Promise<LineWorkspace | LineRefusal>;
  getPlan: () => Promise<PlanView | LineRefusal>;
  addPlanStep: (req: PlanStepRequest) => Promise<PlanView | LineRefusal>;
  /** One step, or several with one click (Import). Sends the page's approval token (x-line-approval). */
  approvePlanStep: (stepId: string | string[]) => Promise<PlanView | LineRefusal>;
  runPlan: (stepId?: string) => Promise<PlanView | LineRefusal>;
  getTools: () => Promise<ToolList | LineRefusal>;
  getFragments: (file: string) => Promise<FragmentList | LineRefusal>;
  importFolders: () => Promise<ImportFolders | LineRefusal>;
  importScan: (req: ImportScanRequest) => Promise<ImportScan | LineRefusal>;
  importPlan: (req: ImportPlanRequest) => Promise<ImportPlan | LineRefusal>;
  newProject: (req: NewLineProjectRequest) => Promise<NewLineProjectResult | LineRefusal>;
  getAiProfiles: () => Promise<AiProfiles | LineRefusal>;
  trace: (req: TraceRequest) => Promise<TraceMatch | LineRefusal>;
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
