// #395/#771 -- one saved flow step, as packages/core/flows.mjs validates and persists it (a plan step
// shape: PLAN_FLOWS id + its args). Opaque to this read-only slice; the compose slice (#772) is what
// picks/edits these.
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
