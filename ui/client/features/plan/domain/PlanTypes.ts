// Plan mode (#289 intake + impact, #332 plan review and edit): server shapes (ui/server /api/plan) and the screen state.
import type { Note } from '@/features/notes';
import type { Executor, Provenance, Status, Ticket } from '../types.ts';

export type { Executor, Provenance, Status, Ticket };


export type Constraints = {
  framework: string | null;
  featuresRoot: string;
  layers: { name: string; canImport: string[] }[];
  rules: { id: string; severity: string }[];
  frozen: string[];
  exceptions: number;
};

export type FlowArg = {
  name: string;
  type: 'string' | 'string[]' | 'boolean' | 'object';
  required: boolean;
  enum?: string[];
  description?: string;
  path: boolean;
};

export type FlowInfo = {
  id: string;
  summary: string;
  writes: boolean;
  executors: Executor[];
  offered: boolean;
  notOffered?: string;
  args: FlowArg[];
};

export type PlanContext = {
  project: string;
  constraints: Constraints;
  features: { ref: string; name: string }[];
  flows: FlowInfo[];
};

export type Proposal = {
  ref: string;
  provenance: 'inferred';
  method: string;
  matchKind?: string;
  confidence: number;
  why: string;
  evidence: string;
};

export type ImpactReason = { code: string; message: string };
export type ImpactFile = {
  path: string;
  layer: string | null;
  feature: string | null;
  scope: string;
  distance: number;
  provenance: Provenance;
  reasons: ImpactReason[];
  purpose?: string | null;
  test?: boolean;
};
export type ImpactFeature = {
  name: string;
  kind: string;
  provenance: Provenance;
  files: number;
  seeded: boolean;
  layers: { layer: string; files: number }[];
  why: string;
};
export type ImpactWarning = { code: string; severity: string; provenance: Provenance; file?: string; message: string };
export type ImpactReport = {
  summary: string;
  seeds: { ref: string; resolved: boolean; provenance?: string; error?: { message: string } }[];
  features: ImpactFeature[];
  files: ImpactFile[];
  warnings: ImpactWarning[];
  stats: { derived: number; inferred: number; filesImplicated: number; truncated?: boolean };
};

/** One step of the plan the user is editing. Same shape as schemas/plan.v1.json's step. */
export type PlanStep = {
  id: string;
  title: string;
  flow: string;
  args: Record<string, unknown>;
  executor: Executor;
  dependsOn?: string[];
  touches?: { features: string[]; files: { path: string; change: string; layer?: string; why?: string }[] };
  rationale?: string;
};


export type PlanDoc = {
  version: 1;
  ticket: { source: 'text'; title: string; body?: string };
  steps: PlanStep[];
};

export type PlanError = { code: string; path: string; message: string; plain: string };

export type StepPreview = { id: string | null; manual: boolean; argv: string[] | null; stdin: string | null; model: boolean };

export type Validation = {
  valid: boolean;
  errors: PlanError[];
  steps: StepPreview[];
  touches: { features: string[]; files: { path: string; changes: string[]; steps: string[]; layer?: string }[] };
};


/** The durable note this screen is writing to (#609): what the server last confirmed, never the text itself. */
export type PlanNote = { id: string; rev: number; status: 'draft' | 'plan-ready' | 'ran'; planStale: boolean; processId: string | null };

export type NoteSave =
  | { status: 'idle' | 'saving' | 'saved' }
  | { status: 'failed'; message: string }
  /** Someone else saved first; `theirs` is the copy on disk. */
  | { status: 'conflict'; theirs: Note };

export type ScreenState = {
  contextStatus: Status;
  contextError: string | null;
  context: PlanContext | null;
  ticket: Ticket;
  picked: string[];
  proposals: Proposal[] | null;
  proposalsStatus: Status;
  proposalsError: string | null;
  accepted: string[];
  impactStatus: Status;
  impactError: string | null;
  impact: ImpactReport | null;
  /** The provenance of the seeds the shown impact was computed from. */
  impactSeeds: { explicit: number; inferred: number };
  steps: PlanStep[];
  nextId: number;
  validation: Validation | null;
  /** JSON of the steps+ticket the current `validation` answers, so a stale answer never enables Run. */
  validatedFor: string | null;
  runStatus: Status;
  runError: string | null;
  runErrors: PlanError[];
  startedId: string | null;
  startedModels: string[];
  note: PlanNote | null;
  noteSave: NoteSave;
};

export type ScreenAction =
  | { type: 'CONTEXT_LOADING' }
  | { type: 'CONTEXT_LOADED'; context: PlanContext }
  | { type: 'CONTEXT_FAILED'; error: string }
  | { type: 'TICKET'; ticket: Partial<Ticket> }
  | { type: 'TOGGLE_PICK'; ref: string }
  | { type: 'PROPOSALS_LOADING' }
  | { type: 'PROPOSALS_LOADED'; proposals: Proposal[] }
  | { type: 'PROPOSALS_FAILED'; error: string }
  | { type: 'TOGGLE_ACCEPT'; ref: string }
  | { type: 'IMPACT_LOADING' }
  | { type: 'IMPACT_LOADED'; impact: ImpactReport; seeds: { explicit: number; inferred: number } }
  | { type: 'IMPACT_FAILED'; error: string }
  | { type: 'STEPS'; steps: PlanStep[]; nextId: number }
  | { type: 'VALIDATED'; validation: Validation; for: string }
  | { type: 'RUN_LOADING' }
  | { type: 'RUN_STARTED'; processId: string; models: string[] }
  | { type: 'RUN_FAILED'; error: string; errors: PlanError[] }
  /** Open a saved note: its text and its plan replace what is on screen. */
  | { type: 'NOTE_OPENED'; note: Note }
  /** The server confirmed a copy (after a save, a create or a Run): only the bookkeeping moves, the typed text stays. */
  | { type: 'NOTE_SYNCED'; note: Note }
  | { type: 'NOTE_SAVING' }
  | { type: 'NOTE_SAVE_FAILED'; message: string }
  | { type: 'NOTE_CONFLICT'; theirs: Note }
  /** Back to idle so autosave tries again (Retry). */
  | { type: 'NOTE_RETRY' };

/** What every /api/plan call resolves to: the data, or a plain error (and the validator's named errors when it refused a plan). */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; errors?: PlanError[] };
