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
export type LineRefusal = { ok: false; sentence: string; code: string; detail?: string; fixes?: LineFix[] };

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

// cu5: a page's two bindings (packages/engine/line/pageBinding.mjs, contract.mjs LinePageBinding). Morpheus: each part's
// library component. Trace: each part's data, states and actions bound to the API.
/** Morpheus's side of one part. */
export type PartBase = { kind: 'library' | 'feature' | 'local' | 'outside' | 'html'; libraryId: string | null; from: string | null; sentence: string };
/** Trace's side of one part: the data it shows. */
export type PartData = { kind: 'list' | 'value' | 'input' | 'static' | 'none'; endpoint: string | null; field: string | null; sentence: string };
/** A state of a part (shown when, disabled when, loading...), with Trace's question for Product or Design. */
export type PartState = { id: string; kind: string; condition: string; sentence: string; team: string; requirement: string };
export type PagePartBinding = { id: string; tag: string; depth: number; line: number; base: PartBase; data: PartData; states: PartState[]; interactions: string[] };
export type PageInteraction = {
  id: string;
  partId: string;
  prop: string | null;
  label: string;
  verb: string;
  handler: 'none' | 'stub' | 'function';
  resolution: 'api' | 'controller' | 'stub' | 'unresolved';
  endpoint: string | null;
  sentence: string;
};
/** A typed fix of an unresolved action: one plan step, recommended first (rank 1). */
export type BindingFix = { id: string; sentence: string; rank: number; step: { tool: 'line.bindInteraction' | 'line.bindPart'; args: Record<string, unknown> } };
export type BindingFinding = { key: string; partId: string; interactionId: string; sentence: string; fixes: BindingFix[] };
export type ContractEndpoint = { id: string; method: string; path: string; role: string; says: string };
/** GET /api/line/page-binding?file=. `via: 'static'` (with `note`) when Trace is down: only the library side is filled. */
export type LinePageBinding = {
  file: string;
  feature: string;
  page: string;
  contentHash: string;
  via: 'trace' | 'static';
  note: string | null;
  contract: { file: string | null; state: 'none' | 'invalid' | 'empty' | 'ok'; sentence: string; endpoints: ContractEndpoint[] };
  parts: PagePartBinding[];
  interactions: PageInteraction[];
  findings: BindingFinding[];
  coverage: { total: number; api: number; controller: number; stub: number; unresolved: number; rate: number };
  components: { id: string; name: string }[];
};
/** line.bindPart: one part becomes a library component. */
export type BindPartRequest = { file: string; partId: string; libraryId: string; contentHash?: string };
/** line.bindInteraction: one action to an endpoint, a controller verb or a marked stub. */
export type BindInteractionRequest = { file: string; interactionId: string; to: 'endpoint' | 'controller' | 'stub'; endpoint?: string; verb?: 'select' | 'clear'; contentHash?: string };

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
/** Expressions (contract.mjs LineExpr): a check as plain JSON over the project's facts; never code. */
export type LineExpr = null | boolean | number | string | { [op: string]: unknown };
export type PlanCheck = { id: string; sentence: string; kind: PlanCheckKind; expr?: LineExpr };
/** Expressions (contract.mjs ExprEvaluation): each failed part as one plain-English sentence. */
export type ExprEvaluation = { ok: boolean; failed: { path: string; sentence: string }[] };
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
/** cu4: one component in the Components editor (GET /api/line/component, packages/engine/line/components.mjs). */
export type ComponentSource = { kind: string; slot?: string; prop?: string; primitive?: string };
export type ComponentAction = { kind: string; primitive?: string; action?: string; prop?: string; value?: string | number | boolean; name?: string };
export type ComponentDiagramState = { id: string; label: string; sentence: string; initial: boolean; final: boolean; role: null; page: null; current: boolean };
export type ComponentDiagram = {
  initial: string;
  current: string;
  states: ComponentDiagramState[];
  transitions: { id: string; from: string; to: string; event: string; origin: 'library'; when: string; do: string }[];
};
export type ComponentPrimitive = { ref: string; primitive: string; origin: 'used' | 'attached'; roles: { role: string; label: string; sentence: string }[]; diagram: ComponentDiagram | null };
export type ComponentEventFix = { label: string; sentence: string; remove: string[]; add: { source: ComponentSource; action: ComponentAction }[] };
export type ComponentEventGroup = { key: string; label: string; sentence: string; actions: { wire: string; label: string; sentence: string }[]; conflicts: string[]; fix: ComponentEventFix | null };
export type LineComponentEditor = {
  file: string;
  name: string;
  kind: 'library' | 'feature';
  feature: string | null;
  baseName: string | null;
  readOnly: boolean;
  readOnlySentence: string | null;
  api: { props: { name: string; type: string; values: (string | number)[] }[]; slots: string[]; events: string[] };
  via: 'studio' | 'static';
  viaSentence: string;
  behaviour: { primitives: ComponentPrimitive[]; fits: { primitive: string; reason: string; mapping: Record<string, string> }[] };
  events: {
    groups: ComponentEventGroup[];
    sources: { id: string; label: string; source: ComponentSource }[];
    actions: { id: string; label: string; action: ComponentAction }[];
  };
  states: {
    rows: { id: string; name: string; origin: string; sentence: string }[];
    current: { ref: string; primitive: string; state: string; label: string; sentence: string; shows: string | null }[];
  };
};
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
export type LineScreen = 'components' | 'pages' | 'features' | 'plan' | 'open-project';
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
/** Import agent (ci2, contract.mjs ImportAgentView): the Import process for one folder, kept in <folder>/line/import-plan.json. */
export type ImportAgentState = 'idle' | 'scan' | 'map' | 'characterize' | 'classify' | 'plan' | 'review' | 'execute' | 'verify' | 'done';
export type ImportAgentStep = {
  id: string;
  tool: ImportStepTool;
  args: Record<string, unknown>;
  sentence: string;
  review: 'proposed' | 'approved' | 'skipped';
  run: 'todo' | 'running' | 'done' | 'needs-you' | 'left';
  planStepIds: string[];
  rounds: number;
  outcome: string | null;
  approvedBy?: 'ui' | 'agent' | null;
};
export type ImportChange = { n: number; at: string; by: 'ui' | 'agent' | 'line'; action: string; stepId?: string; sentence: string };
export type ImportDecision = { id: string; question: string; options: string[]; picked: string; answer: string; by: 'static' | 'single' | 'order' | 'jev' | 'person'; reason: string };
export type ImportAgentQuestion = { id: string; sentence: string; options: { id: string; sentence: string }[]; recommended: string };
export type ImportWaiting = { for: 'review' | 'approval' | 'answer'; sentence: string; stepId?: string; planStepId?: string; question?: ImportAgentQuestion };
export type ImportVerifyCheck = { id: 'validate' | 'types' | 'tests' | 'char-tests' | 'logic-map' | 'behaviour' | 'coverage'; state: 'pass' | 'fail' | 'skipped'; sentence: string; detail?: string };
/** Line Import v2 (importLoop.mjs logicView): the logic map, what each checked step kept, the coverage, in plain English. */
export type ImportMissingUnit = { fingerprint: string; id: string; kind: string; fn: string; file: string; detail: string; sentence: string; block: string; waived: boolean };
export type ImportLoopStep = { step: string; n: number; status: 'ok' | 'stopped'; sentence: string; kept: number; moved: number; missing: number; added: number; changed: number; tests: { passed: number; failed: number; total: number; state: string } };
export type ImportLogicView = {
  route: string | null;
  files: number;
  units: number;
  counts: Record<string, number>;
  kept: number;
  keptSentence: string;
  missing: ImportMissingUnit[];
  coverage: { covered: number; uncovered: number; waived: number; total: number } | null;
  tests: { state: string; passed: number; failed: number; total: number; sentence?: string } | null;
  testCount: number;
  waivers: { fingerprint: string; by: 'owner'; why: string; at?: string }[];
  steps: ImportLoopStep[];
  sentence: string;
};
export type ImportAgentView = {
  ok: true;
  folder: string;
  state: ImportAgentState;
  paused: boolean;
  waiting: ImportWaiting | null;
  stages: { id: string; label: string; status: 'done' | 'current' | 'todo' }[];
  sentence: string;
  steps: ImportAgentStep[];
  decisions: ImportDecision[];
  changes: ImportChange[];
  verify: { ok: boolean; checks: ImportVerifyCheck[] } | null;
  logic?: ImportLogicView | null;
  decider: string;
  message?: string;
};
export type ImportStepAction = 'edit' | 'skip' | 'unskip' | 'move' | 'approve' | 'approve-all';
export type ImportStepEdit = { folder: string; stepId?: string; action: ImportStepAction; args?: Record<string, unknown>; to?: number };
export type ImportAnswerRequest = { folder: string; questionId: string; optionId: string };

/** System 1 drafter (contract.mjs DraftView; flag LINE_DRAFTER=1): every route for a request, each tried by Construct on
 * a copy of the project. A picked route's steps join the plan and wait for approval like any other step. */
export type DraftRouteStatus = 'ok' | 'refused' | 'wrong-shape' | 'failed' | 'needs-model' | 'unverified';
export type DraftRouteView = {
  id: string;
  label: string;
  risk: string;
  status: DraftRouteStatus;
  sentence: string;
  via: 'template' | 'retrieval' | 'model';
  confidence: number;
  cost: { steps: number; files: number; layers: number };
  steps: { tool: string; args: Record<string, unknown> }[];
  fix: { sentence: string } | null;
  /** im3 + j5: why memory moved this route first ("Recalled from 3 past decisions: ..."), else null. */
  memory?: string | null;
  /** im2: the local model's repair of a refused model route: the outcome, the live line per attempt, every attempt. */
  repair?: { outcome: string; sentence: string; progress: string[]; tries: { n: number; reason: string; outcome: string; refusal: string | null }[] } | null;
};
export type DraftQuestion = { word: string; sentence: string; choices: { key: string; label: string }[]; suggested: string | null };
export type DraftView = {
  ok: true;
  on: true;
  request: string;
  normalized: string;
  intent: { id: string; confidence: number; inCatalog: boolean };
  routes: DraftRouteView[];
  recommended: string | null;
  defer: { to: 'qwen' | 'ask' | null; sentence: string };
  questions: DraftQuestion[];
  dropped: { sentence: string }[];
  /** im3 + j5: what memory recalled when it moved a checked route first. */
  memory?: { route: string; count: number; sentence: string } | null;
};
/** POST /api/line/plan/draft/add: the plan with the route's steps added; `next` is the step to add after the first ones ran. */
export type DraftAdded = PlanView & { added: string[]; next: number | null; sentence: string };

/** Every LINE_API route, as the client calls it. Bodies come back as the server sent them, refusals included; each
 * screen turns them into what it shows. A network failure rejects. */
export type LineHttp = {
  getProject: () => Promise<LineProject | LineRefusal>;
  getPageTree: (file: string) => Promise<LinePageTree | LineRefusal>;
  render: (file: string, props?: string) => Promise<RenderResult>;
  getFeature: (name: string) => Promise<LineFeatureDetail | LineRefusal>;
  getWorkspace: () => Promise<LineWorkspace | LineRefusal>;
  getWorkflows: (feature: string) => Promise<LineWorkflowList | LineRefusal>;
  getComponent: (file: string) => Promise<LineComponentEditor | LineRefusal>;
  setWorkspace: (req: WorkspaceRequest) => Promise<LineWorkspace | LineRefusal>;
  getPlan: () => Promise<PlanView | LineRefusal>;
  addPlanStep: (req: PlanStepRequest) => Promise<PlanView | LineRefusal>;
  /** One step, or several with one click (Import). Sends the page's approval token (x-line-approval). */
  approvePlanStep: (stepId: string | string[]) => Promise<PlanView | LineRefusal>;
  runPlan: (stepId?: string) => Promise<PlanView | LineRefusal>;
  getTools: () => Promise<ToolList | LineRefusal>;
  getDraftStatus: () => Promise<{ ok: true; on: boolean } | LineRefusal>;
  draft: (request: string) => Promise<DraftView | LineRefusal>;
  addDraftRoute: (request: string, routeId: string, from?: number) => Promise<DraftAdded | LineRefusal>;
  answerDraft: (word: string, key: string) => Promise<{ ok: true; sentence: string } | LineRefusal>;
  getFragments: (file: string) => Promise<FragmentList | LineRefusal>;
  getPageBinding: (file: string) => Promise<LinePageBinding | LineRefusal>;
  importFolders: () => Promise<ImportFolders | LineRefusal>;
  importScan: (req: ImportScanRequest) => Promise<ImportScan | LineRefusal>;
  importPlan: (req: ImportPlanRequest) => Promise<ImportPlan | LineRefusal>;
  newProject: (req: NewLineProjectRequest) => Promise<NewLineProjectResult | LineRefusal>;
  getAiProfiles: () => Promise<AiProfiles | LineRefusal>;
  /** im3 + j5: the open project's memory per step. */
  getMemory: () => Promise<MemoryView | LineRefusal>;
  /** im3 + j5: forget one step's memory (a person only: sends the approval token). */
  forgetMemory: (step: string) => Promise<(MemoryView & { message: string }) | LineRefusal>;
  /** im1: the miss report (absent vs picked per step) Settings shows under "AI steps". */
  getMisses: () => Promise<MissReportView | LineRefusal>;
  trace: (req: TraceRequest) => Promise<TraceMatch | LineRefusal>;
  getImportAgent: (folder: string) => Promise<ImportAgentView | LineRefusal>;
  startImportAgent: (folder: string, route?: string) => Promise<ImportAgentView | LineRefusal>;
  resumeImportAgent: (folder: string) => Promise<ImportAgentView | LineRefusal>;
  pauseImportAgent: (folder: string) => Promise<ImportAgentView | LineRefusal>;
  editImportStep: (req: ImportStepEdit) => Promise<ImportAgentView | LineRefusal>;
  answerImportAgent: (req: ImportAnswerRequest) => Promise<ImportAgentView | LineRefusal>;
};

/** im3 + j5: GET /api/line/memory (packages/engine/line/memory/contract.mjs MemoryView). */
export type MemoryView = { ok: true; steps: { step: string; label: string; size: number }[]; total: number; sentence: string };

/** cu2: one AI step's profile (Cockpit, Trace and Construct steps are one set; contract.mjs StepProfile). */
export type StepProfile = {
  step: string;
  label: string;
  kind: 'decide' | 'draft';
  provider: 'ollama' | 'hosted';
  model: string | null;
  modelFrom: string;
  maxTokens: number;
  /** im2: how many repairs the step may try (construct.repair). */
  maxAttempts?: number;
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

/** im1: GET /api/line/misses (MissReportView in packages/engine/line/contract.mjs). */
export type MissReportView = {
  ok: true;
  total: { misses: number; absent: number; picked: number };
  steps: { step: string; absent: number; picked: number; total: number; sentence: string }[];
  topAbsent: { pattern: string; step: string; count: number; sources: string[]; examples: string[]; sentence: string }[];
  sentence: string;
  from: string;
  numbers: { train: { n: number; recall: number; precision: number; preferred: number } | null; drafter: { n: number; recall: number; precision: number; preferred: number } | null } | null;
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
