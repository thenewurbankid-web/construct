// Server response shapes (/api/debug) and the screen state (LIN-137, part of LIN-82/epic #616). Mirrors
// requirement/domain/RequirementTypes.ts's shape (a stateless read: the client sends the feature and every answer
// so far, in chooser order; the server replays them).
import type { PlanDoc } from '@/features/plan';

export type { PlanDoc };

export type StepId = 'debug.reproduce' | 'debug.isolate' | 'debug.fix' | 'debug.verify';

export const STEP_ORDER: StepId[] = ['debug.reproduce', 'debug.isolate', 'debug.fix', 'debug.verify'];

export type ChooserOption = { id: string; label: string; enabled: boolean; why: string };
export type ChooserSummary = { id: StepId; question: string; options: ChooserOption[]; chosen: string | null };
export type ChooserExit = { kind: 'manual' | 'ai'; label: string };

export type Answer = { chooser: StepId; option: string };

export type PlanErrorLike = { code: string; path: string; message: string };

export type ReadResult = {
  feature: string;
  steps: StepId[];
  summaries: Record<StepId, ChooserSummary>;
  exits: Record<StepId, ChooserExit>;
  current: StepId | null;
  done: boolean;
  fixIsAi: boolean;
  plan: PlanDoc | null;
  errors?: PlanErrorLike[];
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type Status = 'idle' | 'loading' | 'ready' | 'failed';

/** Whether the last debug.verify result should send the chain back to debug.isolate (any non-pass), the UI/CLI
 * mirror of packages/core/debug-chain.mjs's `shouldReiterate` (the client never imports server-side core code;
 * kept behaviourally identical by domain/Verify.spec.mjs, which checks both against the same inputs). */
export type VerifyStatus = 'idle' | 'awaiting' | 'passed';

export type ScreenState = {
  feature: string;
  answers: Answer[];
  read: { status: Status; error: string | null; result: ReadResult | null };
  approve: { status: Status; error: string | null; processId: string | null };
  verify: { status: VerifyStatus; iterations: number };
};

export type ScreenAction =
  | { type: 'FEATURE'; feature: string }
  | { type: 'READ_LOADING' }
  | { type: 'READ_LOADED'; result: ReadResult }
  | { type: 'READ_FAILED'; error: string }
  | { type: 'ANSWERS'; answers: Answer[] }
  | { type: 'APPROVE_LOADING' }
  | { type: 'APPROVE_STARTED'; processId: string }
  | { type: 'APPROVE_FAILED'; error: string }
  | { type: 'VERIFY_RESULT'; passed: boolean };
