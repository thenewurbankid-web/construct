// The Plan panel's view models. The plan's shapes come from the one shared mirror (lib/lineContract.ts), which follows
// packages/engine/line/contract.mjs (PlanView).
import type { ApplyResult, PlanStepRequest, PlanStepState, PlanView } from '@/lib/lineContract';

export type * from '@/lib/lineContract';

/** What a plan call answers on the screen: the plan, or one sentence saying why not. */
export type PlanAnswer = { ok: true; view: PlanView } | { ok: false; sentence: string; code?: string; detail?: string };

/** What adding a step answers a screen: the step's sentence, or the refusal (with its code and technical detail). */
export type StepAdded = { ok: boolean; sentence: string; code?: string; detail?: string };

/** The service's surface, so the real API and a test double are interchangeable. */
export type LinePlanApi = {
  getPlan: () => Promise<PlanAnswer>;
  addStep: (req: PlanStepRequest) => Promise<PlanAnswer>;
  approve: (stepId: string) => Promise<PlanAnswer>;
  run: (stepId?: string) => Promise<PlanAnswer>;
};

/** One choice offered when a step needs the person. */
/** One choice offered when a step needs the person; a fix carries the plan step that applies it. */
export type StepChoice = { key: string; id: 'retry' | 'leave' | 'fix'; label: string; sentence: string; step?: { tool: string; args: Record<string, unknown> } };

/** One step as the panel shows it: the sentence first, the technical part (tool call, checks, files) for Details. */
export type PlanStepRow = {
  id: string;
  n: number;
  state: PlanStepState;
  /** "Waiting for your approval", "Done", "Needs you", ... */
  stateLabel: string;
  sentence: string;
  /** Before it runs: "Already there: ...", "To do: ...". */
  gapLines: string[];
  /** After it ran: the failing checks, in plain English. */
  failing: string[];
  /** What Construct's findings suggest: every fix in plain English (advice-only ones included). */
  fixes: string[];
  choices: StepChoice[];
  canApprove: boolean;
  /** Details: the tool call, each check with its outcome, the files written. */
  call: string;
  checks: string[];
  files: string[];
};

/** The last step that ran, for a screen's own notice (its ApplyResult when it was a change). */
export type LastRun = { stepId: string; tool: string; apply: ApplyResult | null; sentence: string };

/** Everything a screen needs from the plan: the rows, adding a step, and the person's decisions. */
export type PlanControls = {
  rows: PlanStepRow[];
  storeSentence: string;
  error: string | null;
  busy: boolean;
  lastRun: LastRun | null;
  /** Adds a step and answers its sentence ("Waiting for your approval: ...") or the refusal. */
  addStep: (req: PlanStepRequest) => Promise<StepAdded>;
  approve: (stepId: string) => void;
  choose: (stepId: string, choice: StepChoice) => void;
  refresh: () => void;
};
