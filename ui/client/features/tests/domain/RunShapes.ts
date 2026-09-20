// Shapes for running the tests (#305): the server's /api/tests/:feature/runs and what the run panel draws from it.
// Every word of a failure comes from core (src/engine/testRunner.mjs); the Cockpit only draws it.
import type { TestArea } from '../types.ts';

export type RunStep = { n: number; sentence: string };
export type RunFailure =
  | { kind: 'convention'; title: string; message: string; selector: string; event: string | null; why: string; step: RunStep | null; page: string | null; fix: string }
  | { kind: 'app'; title: string; message: string; expected: string; reached: string; summary: string; step: RunStep | null; page: string | null; bugReport?: string }
  | { kind: 'other'; title: string; message: string; step: null };
export type RunStatus = 'passed' | 'failed' | 'not-run';
export type RunOutcome = { file: string; area: TestArea; title: string; status: RunStatus; durationMs: number; reason?: string | null; failure?: RunFailure };
export type RunTarget = { name: string; area: TestArea } | null;
export type RunLive = { state: 'queued' | 'running' | 'paused'; processId: string; target: RunTarget };
export type RunProblem = { state: 'error' | 'cancelled'; code: string; message: string; target: RunTarget };
export type RunCounts = { total: number; passed: number; failed: number; notRun: number };
export type RunSnapshot = {
  ok: true;
  live: RunLive | null;
  tests: RunOutcome[];
  lastRun: { baseUrl: string; durationMs: number; counts: RunCounts; target: RunTarget; processId: string } | null;
  problem: RunProblem | null;
  defaultBaseUrl: string;
};
export type RunReply = { ok: true; snap: RunSnapshot } | { ok: false; error: string; code?: string; snap?: RunSnapshot };

/** The words for one outcome, kept as data so the symbol and the word always travel together (never colour alone). */
export type OutcomeView = { symbol: string; word: string; tone: 'ok' | 'error' | 'muted' };
/** A result as drawn: `status` is 'none' for a test nothing has run. */
export type ResultMark = OutcomeView & { status: RunStatus | 'none' };

/** One test's row in the results list. */
export type RunRowView = { key: string; area: TestArea; file: string; title: string; mark: ResultMark; detail: string };
/** Everything the run panel draws, as plain text and flags, so the components hold no rules. */
export type RunPanelView = {
  busy: boolean;
  live: { state: string; text: string } | null;
  problem: { heading: string; message: string; code: string } | null;
  done: string | null;
  rows: RunRowView[];
  failures: RunOutcome[];
};
/** What one test's detail draws about its last run. */
export type TestRunView = { mark: ResultMark; detail: string; outcome: RunOutcome };

/** The run panel's props: the view, the address field, and what a click does. */
export type RunPanelProps = {
  view: RunPanelView;
  address: string;
  refused: string | null;
  copied: string | null;
  canRun: boolean;
  onAddress: (value: string) => void;
  onRunAll: () => void;
  onCancel: () => void;
  onCopy: (key: string, text: string) => Promise<boolean>;
  onOpenTest: (area: TestArea, file: string) => void;
};

/** Running one test from its detail: its last result and the actions. */
export type TestRunProps = { view: TestRunView | null; busy: boolean; copied: string | null; onRun: () => void; onCopy: (key: string, text: string) => Promise<boolean> };
