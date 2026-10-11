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

/** What the panel renders for any state: one status sentence and the rows (empty until loaded). */
export type AiStepsView = { status: string; rows: AiStepRow[] };

/** What the panel needs from the server (real or mock). */
export type AiStepsApi = Pick<LineHttp, 'getAiProfiles'>;
