// The inline Generate control's slot contract (docs/design/ia-five-screens.md section 8.6,
// issue #382). Every step that can be produced plugs in through these props/events; the
// control itself never calls a write API — `onRun` is the only way out, and the caller
// decides what happens (and lands the result as a diff in Approvals).

/** Groups actions for the remembered Mechanical/AI choice ("fill a layer", "propose a fix",
 * ...) — not the individual actionId, so choosing AI for one route's "generate tests" carries
 * to the next route's, but never to a different action kind. */
export type ActionKind = string;

export type GenerateMode = 'mechanical' | 'ai';

/** `null` means no deterministic block exists yet for this action (the "AI only" state). */
export type MechanicalOption = { block: string; command: string } | null;

/** `null` means AI is not offered here at all (not even as a locked-out choice). */
export type AiOption = { allowed: boolean; model: string | null } | null;

/** What choosing AI would send, computed before running — the disclosure text is built from
 * this, never from a guess. */
export type WillSend = { files: number; bytes: number; calls: number };

export type GenerateResult = {
  ok: boolean;
  /** One line, e.g. "3 files staged for review" or "Model is offline". */
  summary: string;
  /** Set once the run produced something in Approvals. */
  artifactId?: string | null;
};

export type GenerateControlProps = {
  actionId: string;
  actionKind: ActionKind;
  label: string;
  mechanical: MechanicalOption;
  ai: AiOption;
  willSend: WillSend | null;
  target: string | null;
  /** Set when the action cannot run right now (e.g. "Select part of the page first"); takes
   * priority over every other state except `running`/`result`. */
  disabledReason?: string | null;
  /** From the local-model status check — drives the "refused: model offline" state. */
  modelOffline: boolean;
  /** The remembered choice for this action kind (owned by the caller via `useGenerateMode`,
   * docs/design/ia-five-screens.md section 8.6: "stored per user and per action kind"). */
  mode: GenerateMode;
  running: boolean;
  result?: GenerateResult | null;
  onRun: (mode: GenerateMode) => void;
  onCancel: () => void;
  onChooseMode: (mode: GenerateMode) => void;
};

export type GenerateViewState =
  | 'disabled'
  | 'running'
  | 'result'
  | 'ai-only'
  | 'refused-offline'
  | 'ai-disclosure'
  | 'idle';
