/** Mirrors src/engine/workflowExtractor.mjs's output (served by ui/server's
 * GET /api/workflows/machines) — extracted fresh from the real source on
 * every request, never stored client-side or on disk. */
export type WorkflowState = {
  path: string;
  name: string;
  parent: string | null;
  type: string;
  initial: boolean;
  final: boolean;
  entry: string[];
  exit: string[];
  line?: number;
};

export type WorkflowTransition = {
  from: string;
  event: string;
  kind: 'on' | 'after' | 'always' | 'onDone' | 'invoke';
  target: string | null;
  rawTarget?: string;
  guard?: string;
  actions: string[];
  /** plain, unguarded, single-branch `on` entry: the only kind that can be edited visually */
  editable?: boolean;
  targetless: boolean;
  unresolved: boolean;
};

export type WorkflowContextField = { name: string; initial: string; type?: string };

export type WorkflowMachine = {
  exportName: string | null;
  id: string;
  line?: number;
  initial: string | null;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
  /** epic #223: context fields (initial value as source text; type when the file declares one) */
  context: WorkflowContextField[];
  contextEditable: boolean;
  /** created with setup({...}): named actions/guards can be declared */
  hasSetup: boolean;
  declared: { actions: string[]; guards: string[] };
  error: string | null;
};

export type WorkflowFileMachines = {
  feature: string;
  file: string;
  path: string;
  machines: WorkflowMachine[];
  error: string | null;
  contentHash?: string;
};

/** Mirrors src/engine/workflowExplain.mjs's per-machine output (served by
 * GET /api/workflows/narrative): plain-English narrative, scenarios and health
 * findings, re-derived from the real source on every request. */
export type NarrativeState = { name: string; path: string; label: string; kind: 'initial' | 'final' | 'compound' | 'normal'; sentences: string[] };

export type NarrativeScenario = {
  id: number;
  title: string;
  happy: boolean;
  route: string;
  events: string[];
  end: { state: string; outcome: 'final' | 'stuck' };
  text: string[];
};

export type NarrativeFinding = { kind: string; severity: 'warning' | 'info'; state: string | null; message: string };

export type NarrativeMachine = {
  machine: string;
  summary: string;
  context?: string[];
  states: NarrativeState[];
  scenarios: NarrativeScenario[];
  truncated: boolean;
  findings: NarrativeFinding[];
  error: string | null;
};

export type WorkflowNarrative = { feature: string; file: string; path: string; machines: NarrativeMachine[]; error: string | null; contentHash?: string };

/** A sentence split into plain text, *state* names and `code` names. */
export type InlineSegment = { kind: 'text' | 'state' | 'code'; value: string };

/** What the components render: the server narrative with sentences pre-split. */
export type NarrativeMachineView = Omit<NarrativeMachine, 'states' | 'scenarios' | 'findings'> & {
  summarySegments: InlineSegment[];
  contextSegments: InlineSegment[][];
  states: (NarrativeState & { sentenceSegments: InlineSegment[][] })[];
  scenarios: (NarrativeScenario & { lineSegments: InlineSegment[][] })[];
  findings: (NarrativeFinding & { messageSegments: InlineSegment[] })[];
};

export type NarrativeView = { machines: NarrativeMachineView[] };

export type DiffHunk = { value: string; added?: boolean; removed?: boolean };

/** One visual edit (see src/engine/workflowEditor.mjs for the ops). */
export type WorkflowEditRequest = {
  machine: number;
  op:
    | 'addState' | 'removeState' | 'renameState' | 'addTransition' | 'removeTransition' | 'retargetTransition'
    | 'addContextField' | 'setContextField' | 'removeContextField'
    | 'declareAction' | 'declareGuard' | 'removeAction' | 'removeGuard' | 'assignAction' | 'unassignAction' | 'setGuard';
  name?: string;
  parent?: string;
  path?: string;
  from?: string;
  event?: string;
  target?: string;
  /** epic #223: context fields, and where an action runs */
  initial?: string;
  type?: string;
  where?: 'entry' | 'exit' | 'transition';
  kind?: WorkflowTransition['kind'];
};

export type PendingWorkflowEdit = { req: WorkflowEditRequest; hunks: DiffHunk[] };

export type WorkflowsState = {
  features: string[];
  feature: string;
  files: string[];
  filesLoading: boolean;
  file: string;
  loaded: WorkflowFileMachines | null;
  error: string | null;
  pending: PendingWorkflowEdit | null;
  editBusy: boolean;
  editError: string | null;
};
