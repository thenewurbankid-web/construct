// Shapes of ui/server's /api/processes (see processesService.mjs). The Cockpit
// only reads these; which controls exist comes from `summary.controls`, the
// state machine's own answer, never from anything decided here.

export type StepExecutor = 'deterministic' | 'local-model' | 'user';
export type StepStatus = 'pending' | 'running' | 'awaiting-user' | 'done' | 'failed' | 'skipped';
export type Provenance = 'ok' | 'llm' | 'warn';
export type TopState = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

/** The machine events a summary can offer. */
export type ControlEvent = 'START' | 'PAUSE' | 'RESUME' | 'CANCEL' | 'RETRY';
/** The verbs the API accepts. There is deliberately no `start` or `approve` verb. */
export type ControlVerb = 'pause' | 'resume' | 'cancel' | 'retry';

export type ProcessSummary = {
  id: string;
  title: string;
  /** Only ever grows; the newest version of a process wins, whatever order updates arrive in. */
  version: number;
  state: TopState;
  stateDetail: string;
  pendingControl: 'pause' | 'cancel' | null;
  currentStepId: string | null;
  progress: { done: number; failed: number; total: number };
  modelSteps: number;
  plannedModelSteps: number;
  artifacts: number;
  pendingApproval: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  terminal: boolean;
  controls: ControlEvent[];
  error: { message?: string } | string | null;
};

export type ProcessStep = {
  id: string;
  title: string;
  flow: string;
  executor: StepExecutor;
  status: StepStatus;
  attempts: number;
  durationMs: number | null;
  llm: { provider?: string; calls?: number } | null;
  error: string | null;
};

export type ProcessArtifact = {
  path: string;
  change: 'create' | 'modify' | 'delete';
  stepId: string | null;
  approved: boolean | null;
  before: { bytes: number; sha256: string | null } | null;
  after: { bytes: number; sha256: string | null } | null;
};

export type ProcessLogEntry = {
  seq: number;
  at: string;
  provenance: Provenance;
  message: string;
  stepId: string | null;
};

/** One process in full, as the detail endpoint and every socket update carry it. */
export type ProcessDetail = {
  summary: ProcessSummary;
  steps: ProcessStep[];
  artifacts: ProcessArtifact[];
  log: ProcessLogEntry[];
  logHidden: number;
};

export type DiffResult = { status: 'loading' } | { status: 'ready'; diff: string | null; reason?: string };

// ---- Display shapes: what the domain builds and the components render as they are. ----

export type ListRow = { id: string; title: string; state: TopState; stateLabel: string; progress: string; percent: number; selected: boolean; note: string | null };
export type StepRow = { id: string; title: string; executor: StepExecutor; kind: string; status: StepStatus; statusLabel: string; note: string | null };
export type LogRow = { key: number; time: string; provenance: Provenance; meaning: string; text: string };
export type ArtifactRow = { path: string; change: string; hash: string; approval: string };
export type DetailView = {
  id: string;
  title: string;
  state: TopState;
  stateLabel: string;
  progress: string;
  percent: number;
  buttons: { verb: ControlVerb; label: string }[];
  steps: StepRow[];
  log: LogRow[];
  logHidden: number;
  artifacts: ArtifactRow[];
  /** The gate reviews a process only when it is not running or queued. */
  canReview: boolean;
  error: string | null;
};

// ---- #341: the approval gate's review and the person's decisions. ----

export type GateRefusal = { code: string; message: string };
export type GateVerdict = { decision: 'approved' | 'rejected'; by?: string; at?: string; applied?: boolean; diffSha256?: string | null };

/** One artifact as the core gate (src/engine/approvalGate.mjs) reviews it. `diffSha256` is what a decision echoes back. */
export type ReviewArtifact = {
  path: string;
  change: 'create' | 'modify' | 'delete';
  stepId: string | null;
  diff: string | null;
  diffSha256: string | null;
  refusals: GateRefusal[];
  applicable: boolean;
  verdict: GateVerdict | null;
  llm: { provider?: string; calls?: number } | null;
};

export type Review = {
  processId: string;
  state: string;
  artifacts: ReviewArtifact[];
  unrecordedBranchChanges: string[];
  resolved: boolean;
};

export type ReviewState = { status: 'loading' } | { status: 'ready'; review: Review } | { status: 'error'; message: string };

export type Violation = { rule?: string; file?: string; message?: string; severity?: string };
/** What `decide` reports after applying: new violations are shown, never auto-reverted. */
export type Validation = { ran: boolean; ok?: boolean; error?: string; newViolations: Violation[]; autoReverted?: boolean };

export type DecideResult =
  | { ok: true; validation: Validation | null }
  | { ok: false; error: string; refusals: GateRefusal[] };

/** The last thing that went wrong when a person decided on one file, shown beside it. */
export type DecisionNote = { error: string; refusals: GateRefusal[] } | null;

export type DiffLine = { key: number; kind: 'add' | 'del' | 'hunk' | 'meta' | 'ctx'; text: string };
export type ReviewRow = {
  path: string;
  change: string;
  diffLines: DiffLine[];
  diffSha256: string | null;
  refusals: GateRefusal[];
  canApprove: boolean;
  canReject: boolean;
  /** Why Approve is off, when it is. */
  approveOffReason: string | null;
  verdict: string | null;
  model: string | null;
  note: DecisionNote;
  busy: boolean;
};
export type ReviewView = {
  processId: string;
  rows: ReviewRow[];
  /** Files on the bot's branch that no artifact records: shown, never applied. */
  unrecorded: string[];
  validationText: string | null;
  validationViolations: string[];
  validationOk: boolean;
  resolved: boolean;
};

export type ProcessesViewProps = {
  rows: ListRow[];
  detail: DetailView | null;
  diffs: Record<string, DiffResult>;
  review: ReviewView | null;
  reviewLoading: boolean;
  reviewError: string | null;
  onReview: (id: string) => void;
  onDecide: (id: string, path: string, verdict: 'approve' | 'reject', diffSha256: string | null) => void;
  busy: boolean;
  notice: string | null;
  error: string | null;
  live: boolean;
  onSelect: (id: string) => void;
  onControl: (id: string, verb: ControlVerb) => void;
  onShowDiff: (id: string, path: string) => void;
};

export type ProcessesState = {
  loaded: boolean;
  error: string | null;
  /** Summaries newest first, as the list endpoint returns them. */
  order: string[];
  details: Record<string, ProcessDetail>;
  selectedId: string | null;
  /** A control is in flight for this process id. */
  busyId: string | null;
  /** The last refusal or failure of a control, shown next to the buttons. */
  notice: string | null;
  diffs: Record<string, DiffResult>;
  /** The gate's review per process id. */
  reviews: Record<string, ReviewState>;
  /** Per `${id}\n${path}`: why the last decision on that file did not go through. */
  notes: Record<string, DecisionNote>;
  /** The check the last approval ran, per process id. */
  validations: Record<string, Validation | null>;
  /** `${id}\n${path}` of the decision in flight, if any. */
  deciding: string | null;
  live: boolean;
};

export type ProcessesAction =
  | { type: 'REVIEW'; id: string; result: ReviewState }
  | { type: 'DECIDING'; key: string | null }
  | { type: 'DECIDED'; id: string; key: string; note: DecisionNote; validation: Validation | null }
  | { type: 'LISTED'; summaries: ProcessSummary[] }
  | { type: 'LIST_FAILED'; error: string }
  | { type: 'UPDATE'; detail: ProcessDetail }
  | { type: 'SELECT'; id: string | null }
  | { type: 'CONTROL_START'; id: string }
  | { type: 'CONTROL_DONE'; notice: string | null }
  | { type: 'DIFF'; key: string; result: DiffResult }
  | { type: 'LIVE'; live: boolean };
