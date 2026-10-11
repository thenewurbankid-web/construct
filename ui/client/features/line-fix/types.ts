// The fix panel's own view models. The shapes of a finding, its typed fixes and the ApplyResult come from the one
// shared Line mirror (lib/lineContract.ts, lib/lineHttp.ts).
import type { ApplyResult, FixRequest, LineFix } from '@/lib/lineContract';

export type { ApplyResult, FixRequest, LineFinding, LineFix } from '@/lib/lineContract';

/** One fix as the panel shows it: the fix, whether it has a step Cockpit can apply (false: advice, do it by hand),
 * and its Apply button's accessible name (what it will do). */
export type FixRow = { fix: LineFix; applicable: boolean; label: string };

/** A finding's fixes as the panel lays them out: the recommended one first, the rest behind "Other ways to fix". */
export type FixOptions = { recommended: FixRow | null; others: FixRow[] };

/** One fix in progress at a time: idle, applying (which one), or done with what the writer answered. */
export type FixState = { phase: 'idle' } | { phase: 'applying'; fixId: string } | { phase: 'done'; result: ApplyResult };

export type FixEvent = { type: 'APPLY'; fixId: string } | { type: 'DONE'; result: ApplyResult };

/** What the panel calls to apply a fix (the server's POST /api/line/fix, or the mock in mock mode). Never rejects. */
export type LineFixApi = { fix: (req: FixRequest) => Promise<ApplyResult> };

/** Everything the panel renders and does. */
export type LineFixView = {
  options: FixOptions;
  state: FixState;
  /** The refusal sentence to show next to the fixes (a landed fix is the screen's notice, not the panel's). */
  refusal: string | null;
  apply: (row: FixRow) => void;
};

/** The screen's notice of the last fix and the handler to give each panel (useLineFixNotice). */
export type LineFixNoticeState = { notice: ApplyResult | null; onResult: FixResultHandler };

/** Called with every answer, landed or refused, so the screen can show its sentence and re-read the project. */
export type FixResultHandler = (result: ApplyResult) => void;
