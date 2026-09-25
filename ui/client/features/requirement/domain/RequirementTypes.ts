// The requirement chain (#642, part of epic #616): the shapes every layer shares. Server shapes are ui/server's
// requirementApi.mjs (POST /api/requirement/read), which returns what packages/core's parseRequirement, placeCard and
// planFromBlocks produce; the screen state is what RequirementMachine.ts reduces.
import type { PlanDoc } from '@/features/plan';

export type NounKind = 'entity' | 'state' | 'ui-part' | 'external';
export type VerbKind = 'read' | 'write' | 'interact' | 'navigate';
export type PlacementKind = 'client-leaf' | 'server-read' | 'mutation' | 'presentational';

export type CardNoun = { id: string; kind: NounKind; text: string; properties?: string[] };
export type CardVerb = { id: string; kind: VerbKind; text: string; on: string[] };
/** One named check, and `from`: the word of the sentence that caused it ("safely"). */
export type CardCheck = { id: string; name: string; from: string; why: string };
export type Card = { source: { text: string }; nouns: CardNoun[]; verbs: CardVerb[]; checks: CardCheck[]; open: { id: string; text: string }[] };

/** A closed question of 2-5 options. `source` says whether a word of the card or a placement is being asked about. */
export type QuestionOption = { id: string; label: string; enabled: boolean; why: string };
export type Question = { id: string; question: string; options: QuestionOption[]; chosen: string | null; source: 'card' | 'placement' };

/** A closed question that never holds the plan back (#619: the screen shape). `default` is the rules' suggestion; nothing is chosen until a person answers. */
export type Offer = Question & { default: string; suggestion?: { option: string; reason: string; provider: string } };
/** What the project's decision provider suggests for one closed question (#633): suggest-only, the person still chooses. `fellBackFrom` names a plugin that failed, the rules provider having answered instead. */
export type Suggestion = { option: string; reason: string; runnerUp: string | null; score?: number; provider: { name: string; version: string }; fellBackFrom?: string };
/** Who answers, what was asked for and every load or fallback line of the decision provider. */
export type DecisionProviderInfo = { name: string; version: string; requested: string; fellBackFrom: string | null; notes: string[] };

/** Who answered a placement question, as the blocks record it: `person`, or `decision-model` with its provider. */
export type Decision = { question: string; option: string; by: string; provider?: string };

export type PlacementLayer = { layer: string; name: string; why: string };
export type PlacementBlock = {
  id: string;
  label: string;
  placement: PlacementKind;
  answers: { browserApi: boolean; touchesSecretOrDb: boolean; changesBackend: boolean };
  layers: PlacementLayer[];
  checkNames: string[];
  why: string;
};
export type Placement = {
  ok: boolean;
  complete: boolean;
  framework: string;
  blocks: PlacementBlock[];
  notes: string[];
  errors: { code: string; path: string; message: string }[];
  decisions?: Decision[];
};

export type ReadResult = {
  card: Card;
  /** null while a word of the card is still open: nothing is placed until a person answers it. */
  placement: Placement | null;
  plan: PlanDoc | null;
  /** The files each block will create, by block id. */
  files: Record<string, string[]>;
  open: Question[];
  /** Closed questions beside the plan (never in `open`): the list shape. Absent from an older server. */
  offers?: Offer[];
  warnings: string[];
  summary: { readBack: string[]; blocks: string[] };
  /** The decision provider's suggestion per open question and offer id (#633). Absent from an older server; empty when the provider is off. */
  suggestions?: Record<string, Suggestion>;
  decisionProvider?: DecisionProviderInfo;
  /** The proof of a shaped screen (#623): its steps and the chain state (pending when it comes from a read). null for a plan with no shaped unit. Absent from an older server. */
  proof?: PlanProof | null;
};

/** What planFromBlocks says about the proof of the chain (packages/core/placement.mjs). */
export type PlanProof = { required: boolean; complete: boolean; state: ProofState; steps: { name: string; kind: string; proofStep: string; verifiedBy: string }[]; verifiedBy: string[] };

/** The four states of the proof of a screen (packages/core/proof.mjs proofStatus). */
export type ProofState = 'pending' | 'green' | 'failed' | 'skipped';
/** One closed option of a proof summary (proofSummary): a stable id, its label and why it is offered. */
export type ProofOption = { id: string; label: string; why: string };
/** One failed test of the proof, classified like the Tests screen's failures (kind app: the state is wrong; convention: a file the proof binds to is gone). */
export type ProofFailure = { test: string; kind: 'app' | 'convention' | 'other'; title: string; summary: string; message: string; expected?: string; reached?: string; selector?: string; fix?: string };
/** A run of the proof, as POST /api/requirement/proof/run answers it. `error` is a run that could not start or finish (no esbuild, timed out). */
export type ProofRun = {
  state: ProofState;
  complete: boolean;
  durationMs: number;
  counts: { total: number; passed: number; failed: number };
  failures: ProofFailure[];
  error: { code: string; message: string } | null;
  summary: { options: ProofOption[] };
};
export type ProofStatusReply = { applied: boolean; options: ProofOption[] };

/** An answer to a closed question, sent back with the sentence: the server replays them in order. */
export type Answer = { id: string; option: string };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type ReadState = { status: 'idle' | 'loading' | 'ready' | 'failed'; result: ReadResult | null; error: string | null };
export type ApproveState = { status: 'idle' | 'running' | 'started' | 'failed'; processId: string | null; error: string | null };
export type NoteState = { status: 'idle' | 'saving' | 'saved' | 'failed'; error: string | null };

/** The proof card's state (#653): whether the plan's files are in the project (unknown until the server says), the last run, and a skip. */
export type ProofCardState = {
  applied: boolean | null;
  /** The closed options the server offered last (proofSummary), so the buttons are its, not a copy. */
  options: ProofOption[];
  run: { status: 'idle' | 'running' | 'done' | 'failed'; result: ProofRun | null; error: string | null };
  skip: { status: 'idle' | 'open' | 'saving' | 'skipped' | 'failed'; draft: string; reason: string | null; error: string | null };
};

export type ScreenState = { text: string; answers: Answer[]; read: ReadState; approve: ApproveState; note: NoteState; proof: ProofCardState };

export type ScreenAction =
  | { type: 'TEXT'; text: string }
  | { type: 'ANSWERS'; answers: Answer[] }
  | { type: 'READ_LOADING' }
  | { type: 'READ_LOADED'; result: ReadResult }
  | { type: 'READ_FAILED'; error: string }
  | { type: 'APPROVE_RUNNING' }
  | { type: 'APPROVE_STARTED'; processId: string }
  | { type: 'APPROVE_FAILED'; error: string }
  | { type: 'NOTE_SAVING' }
  | { type: 'NOTE_SAVED' }
  | { type: 'NOTE_FAILED'; error: string }
  | { type: 'PROOF_APPLIED'; applied: boolean; options: ProofOption[] }
  | { type: 'PROOF_RUN_STARTED' }
  | { type: 'PROOF_RUN_DONE'; run: ProofRun }
  | { type: 'PROOF_RUN_FAILED'; error: string; applied?: boolean }
  | { type: 'PROOF_SKIP_OPEN' }
  | { type: 'PROOF_SKIP_CANCEL' }
  | { type: 'PROOF_SKIP_DRAFT'; draft: string }
  | { type: 'PROOF_SKIP_SAVING' }
  | { type: 'PROOF_SKIP_DONE'; reason: string }
  | { type: 'PROOF_SKIP_FAILED'; error: string };

export type TimelineKind = 'page-load' | 'server-read' | 'presentation' | 'interaction' | 'mutation' | 'redirect';

/** One step of the read-back, in the order the blocks run. */
export type TimelineStep = {
  order: number;
  kind: TimelineKind;
  /** "Page load", "Server read"... */
  title: string;
  /** The block that owns this step, or null for the page load itself. */
  blockId: string | null;
  /** The layers of that block ("service SubscriptionPlan"), so the step shows which units run. */
  owner: string[];
  /** The named checks that guard this step. */
  checks: string[];
  /** One plain-English line. */
  line: string;
};
