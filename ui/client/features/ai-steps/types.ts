// The AI steps view's own view models. The contract's shapes come from the one shared mirror (lib/lineContract.ts).
import type { AiProfiles, LineHttp } from '@/lib/lineContract';

export type * from '@/lib/lineContract';

/** One AI step as Settings shows it: plain English first, the technical part for a collapsed Details. */
export type AiStepRow = {
  step: string;
  /** Which app runs it: "Cockpit", "Trace" or "Construct". */
  app: string;
  label: string;
  model: string;
  how: string;
  details: { step: string; cap: string; ladder: string; measured: string; fallback: string };
};

/** What the panel shows. */
export type AiStepsState =
  | { phase: 'loading' }
  | { phase: 'ready'; profiles: AiProfiles; rows: AiStepRow[] }
  | { phase: 'error'; sentence: string };

/** im3 + j5: one memory step as Settings shows it, with its one-click Forget. */
export type MemoryRow = { step: string; label: string; size: number; sizeText: string; canForget: boolean };

/** im3 + j5: the open project's memory (sentence and rows), the last Forget's message, and Forget itself. */
export type MemoryPanel = { sentence: string; rows: MemoryRow[]; message: string | null; busy: boolean; forget: (step: string) => void };

/** What the panel renders for any state: one status sentence and the rows (empty until loaded). */
export type AiStepsView = { status: string; rows: AiStepRow[] };

/** What the panel needs from the server (real or mock). */
export type AiStepsApi = Pick<LineHttp, 'getAiProfiles' | 'getMemory' | 'forgetMemory'>;
