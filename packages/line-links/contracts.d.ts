// cu1 -- the contracts Construct relies on from the linked Line modules: only the surface the adapters use, written
// against @mx/reason and @mx/plan at the commit links.json pins. A mock for each lives in ./mocks.mjs; the link tests
// check the real modules still fit (test/line-links-*.test.mjs).

/** @mx/reason: a pair profile as a config writes it (profiles.ts `StepProfileInput`, reduced). */
export interface ReasonProfileInput {
  pairId: string;
  stepId: string;
  qwenGuidance: string;
  maxOptions: number;
  proposeRetries: number;
  jevFrame: string;
  review: { enabled: boolean; maxRounds: number };
  ladder?: { static: { target: number }; options: { on: boolean; target: number }; review: { on: boolean; target: number } };
  success: string;
  askUser?: 'never' | 'whenWeak' | 'always';
  coderReview?: boolean;
  plan: { version: string; questions: { id: string; kind: 'pick' | 'suggest' | 'none' | 'hybrid'; note: string; weak?: boolean }[] };
}

/** @mx/reason: jev, or a mock (loop.ts `Picker`). */
export interface ReasonPicker<Q = unknown> {
  readonly name: string;
  available(profile: unknown): Promise<boolean>;
  pick(q: Q, options: readonly string[], profile: unknown): Promise<number>;
}

/** @mx/reason: Qwen, or a mock (loop.ts `Proposer`). Construct's chooser asks pick questions, so it is optional. */
export interface ReasonProposer<Q = unknown> {
  readonly name: string;
  available(profile: unknown): Promise<boolean>;
  propose(q: Q, rejected: readonly { value: string; reason: string }[], profile: unknown, offered?: readonly string[]): Promise<{ options: string[]; favourite: number; note: string }>;
  review(q: Q, options: readonly string[], picked: number, profile: unknown): Promise<{ accept: boolean; note: string; options?: string[] }>;
}

/** @mx/reason: one decided item (loop.ts `Choice`, reduced). */
export interface ReasonChoice {
  key: string;
  options: string[];
  picked: string | null;
  by: 'jev' | 'single' | 'order' | 'none';
  step: 'static' | 'jev' | 'qwen' | 'none';
  lowConfidence: boolean;
  reasoning: string[];
}

/** The part of @mx/reason the decision provider uses. */
export interface ReasonModule {
  defineProfiles(list: readonly ReasonProfileInput[]): Readonly<Record<string, unknown>>;
  runLadder<Q>(
    items: readonly { key: string; q: Q; profile: unknown; questionId?: string; options?: readonly string[] }[],
    tools: { picker?: ReasonPicker<Q>; proposer?: ReasonProposer<Q>; check: (q: Q, value: string, origin: 'static' | 'model') => string | null },
  ): Promise<{ choices: ReasonChoice[]; complete: boolean }>;
}

/** A schema as @mx/plan reads one: `safeParse` only (registry.ts, checks.ts). A zod schema fits; so does Construct's own. */
export interface SchemaLike {
  safeParse(value: unknown): { success: true; data: any } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } };
}

/** @mx/plan registry.ts `ToolSpec`. */
export interface PlanToolSpec {
  readonly name: string;
  readonly kind: 'read' | 'write';
  readonly schema: SchemaLike;
  readonly describe: string;
}

/** @mx/plan registry.ts `Registry`: what the plan runner calls. */
export interface PlanRegistry {
  list(): readonly PlanToolSpec[];
  call(name: string, args: unknown): Promise<unknown>;
}

/** What a Construct command returns as a plan step's result. */
export interface CommandStepResult {
  command: string;
  argv: string[];
  /** The command ran to the end with exit code 0 (validate with findings exits non-zero and is still a result). */
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** stdout parsed, when it is JSON. */
  json?: unknown;
}
