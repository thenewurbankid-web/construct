// Same three executors packages/core/plan.mjs's PLAN_FLOWS declare, and ui/client/features/plan/types.ts's
// `Executor` -- redeclared here rather than imported cross-feature (this feature's public API is its own
// index.ts, like every other feature). 'deterministic' renders as Mechanical; anything else as AI.
export type Executor = 'deterministic' | 'local-model' | 'user';

// #395/#771 -- one saved flow step, as packages/core/flows.mjs validates and persists it (a plan step
// shape: PLAN_FLOWS id + its args).
export type FlowStep = { id?: string; title?: string; flow: string; args?: Record<string, unknown>; executor?: string };

/** One saved flow, as GET /api/envelopes reports it. */
export type FlowSummary = { name: string; stepCount: number; steps: FlowStep[]; error: string | null };

export type EnvelopesStatus = 'idle' | 'running' | 'ready' | 'error';
export type EnvelopesState = { status: EnvelopesStatus; rows: FlowSummary[]; error: string | null };
export type EnvelopesAction = { type: 'RUN' } | { type: 'RESULT'; rows: FlowSummary[] } | { type: 'FAIL'; error: string };

export type EnvelopesApi = { state: EnvelopesState; run: () => void };

export type EnvelopesViewModel = {
  /** 'list' shows rows; 'empty' is a project with no flows saved yet; 'error' is the designed failure state. */
  mode: 'list' | 'empty' | 'error';
  summary: string;
  running: boolean;
  error: string | null;
  rows: FlowSummary[];
};

// #395/#771 slice: the compose center stage -- a step list built from the real plan-flow catalogue
// (PLAN_FLOWS/block-flows.mjs, via GET /api/plan/context's `flows`), add/reorder/remove, no save/run yet
// (#772). Each entry's `executors` is its Mechanical/AI provenance.
export type FlowCatalogueEntry = {
  id: string;
  summary: string;
  executors: Executor[];
  writes: boolean;
  offered: boolean;
  notOffered?: string;
};

/** One step in the compose draft: same shape a saved FlowStep has, always fully populated (no optional fields
 * once it is on the draft list). `touches` is set for a writes-flow (declared empty, since this slice has no
 * arg-editing UI yet) -- packages/core/plan.mjs's validatePlan requires it for any flow that changes files. */
export type ComposeStep = { id: string; title: string; flow: string; args: Record<string, unknown>; executor: Executor; touches?: { features: string[]; files: [] } };

export type ComposeState = { steps: ComposeStep[]; nextId: number; loadedFrom: string | null };

export type ComposeAction =
  | { type: 'ADD'; flow: FlowCatalogueEntry }
  | { type: 'REMOVE'; id: string }
  | { type: 'MOVE'; id: string; dir: -1 | 1 }
  | { type: 'LOAD'; name: string; steps: ComposeStep[] }
  | { type: 'NEW' };

export type ComposeApi = {
  state: ComposeState;
  addStep: (flow: FlowCatalogueEntry) => void;
  removeStep: (id: string) => void;
  moveStep: (id: string, dir: -1 | 1) => void;
  loadFlow: (name: string, steps: FlowStep[]) => void;
  newFlow: () => void;
};

// #395/#772 -- the envelope each step of the compose draft would receive, matching schemas/envelope.v1.json's
// input shape. Computed deterministically server-side (no generator runs); recomputed whenever the draft's
// steps change.
export type EnvelopePreview = { version: 1; feature: string | null; status: string; layers: Record<string, string[]>; steps: { layer: string; name: string }[] };

// #395/#772 -- "Save this flow": a name plus the draft's steps, previewed then committed through #759's
// saveFlow, same preview/commit/Save/Cancel shape as the Rules tab's writers.
export type SaveStatus = 'idle' | 'previewing' | 'ready' | 'saving' | 'error' | 'saved';
export type SaveState = { status: SaveStatus; name: string; error: string | null };
export type SaveAction =
  | { type: 'NAME'; name: string }
  | { type: 'START' }
  | { type: 'PREVIEW_OK' }
  | { type: 'PREVIEW_FAIL'; error: string }
  | { type: 'SAVE' }
  | { type: 'SAVE_OK' }
  | { type: 'SAVE_FAIL'; error: string }
  | { type: 'CANCEL' }
  | { type: 'RESET' };

export type SaveApi = {
  state: SaveState;
  setName: (name: string) => void;
  preview: () => void;
  confirm: () => void;
  cancel: () => void;
};

// #395/#772 -- "Run this flow": the same Process/Approvals path Plan mode's "Run plan" uses (no new/bypass
// execution mechanism) -- one bot at a time, in its own branch, nothing reaches the project until approved
// in the Processes drawer.
export type RunStatus = 'idle' | 'loading' | 'started' | 'error';
export type RunState = { status: RunStatus; processId: string | null; models: string[]; error: string | null };
export type RunAction = { type: 'LOADING' } | { type: 'STARTED'; processId: string; models: string[] } | { type: 'FAILED'; error: string } | { type: 'RESET' };

export type RunApi = { state: RunState; run: () => void };
