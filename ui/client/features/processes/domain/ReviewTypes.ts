// Shapes of the approval gate's review (#341); re-exported from types.ts.
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

