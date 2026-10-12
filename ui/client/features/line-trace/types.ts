// Trace and Auto (cg1, ct1): the shapes come from the one shared mirror (lib/lineContract.ts), which follows
// packages/engine/line/contract.mjs (LineControl, AutoAction, TraceMatch).
import type { AutoAction, LineScreen, PlanStepView, TraceMatch, TraceRequest } from '@/lib/lineContract';

export type * from '@/lib/lineContract';

/** The screens Trace runs on (the Plan panel sits inside Components and Pages). */
export type TraceScreen = Exclude<LineScreen, 'plan' | 'shell'>;

/** What the trace call answers: the match, or one sentence saying why not. */
export type TraceAnswer = { ok: true; match: TraceMatch } | { ok: false; sentence: string };

export type LineTraceApi = {
  trace: (req: TraceRequest) => Promise<TraceAnswer>;
};

/** One control lit on this screen: `kind` says whether the request or an open plan step lit it. */
export type LitControl = {
  controlId: string;
  target: string | null;
  kind: 'request' | 'step';
  label: string;
};
/** Controls lit on another screen, with the link that goes there. */
export type ElsewhereLink = {
  screen: LineScreen;
  title: string;
  href: string;
  labels: string[];
};
export type TraceLights = { here: LitControl[]; elsewhere: ElsewhereLink[] };

/** One Auto run, kept in this tab's history for Replay. */
export type TraceRun = {
  id: string;
  request: string;
  script: AutoAction[];
  at: string;
};

export type RunStatus = 'playing' | 'paused' | 'waiting' | 'done' | 'stopped';
/** Auto's run in progress (kept for the tab's session, so it carries on after it moves to another screen). */
export type RunState = {
  runId: string;
  request: string;
  script: AutoAction[];
  index: number;
  status: RunStatus;
  /** With Trace on: the simulated cursor and a caption per move. Auto alone: no show. */
  show: boolean;
  /** Replay: the cursor goes over the same controls again and changes nothing. */
  replay: boolean;
  /** One move while paused (Step). */
  stepping: boolean;
  caption: string;
};

export type TraceSettings = {
  trace: boolean;
  auto: boolean;
  request: string;
  /** The person let Auto press Approve for them in this session (off until they turn it on). */
  autoApprove: boolean;
  speed: number;
  history: TraceRun[];
  run: RunState | null;
};

/** The Trace bar's lines about a match (domain/TraceFindings.ts). */
export type FindingsView = {
  choice: string | null;
  litHere: string | null;
  elsewhere: { href: string; key: string; text: string }[];
  missing: string | null;
  details: string[];
};

/** One of Auto's run buttons. */
export type AutoButton = { id: 'pause' | 'resume' | 'step' | 'stop'; label: string };

/** Everything the Trace bar shows and does. */
export type TraceView = {
  settings: TraceSettings;
  match: TraceMatch | null;
  lights: TraceLights;
  error: string | null;
  sentence: string;
  cursor: { x: number; y: number } | null;
  findings: FindingsView;
  /** A run is going (or waiting at Approve). */
  active: boolean;
  /** The request has a script Auto can play. */
  canRun: boolean;
  runLabel: string;
  speeds: { value: number; label: string }[];
  buttons: AutoButton[];
  press: (id: AutoButton['id']) => void;
  setTrace: (on: boolean) => void;
  setAuto: (on: boolean) => void;
  setRequest: (text: string) => void;
  setAutoApprove: (on: boolean) => void;
  setSpeed: (speed: number) => void;
  run: () => void;
  replay: (runId: string) => void;
};

export type TraceSteps = PlanStepView[];
