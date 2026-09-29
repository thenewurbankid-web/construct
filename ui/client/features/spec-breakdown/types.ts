// #748 (R6) -- shapes shared across the spec-breakdown feature. `MachineSpecReport` and `ReadBack` mirror
// packages/core/research/machine-spec.mjs's `validateMachineSpec` result and research/readBack.mjs's
// `readBackMachineSpec` result exactly (the server never reshapes them).

export type SpecViolation = { rule: string; module: string; severity: string; file?: string; message: string; why?: string; expected?: string; path?: string };

export type MachineSpecReport = {
  status: 'passed' | 'failed';
  file?: string;
  counts: Record<string, number>;
  violations: SpecViolation[];
};

export type ReadBackItem = { id: string; req: string[]; text: string };

export type ReadBackSentence = {
  id: string;
  text: string;
  status: 'covered' | 'out-of-scope' | 'uncovered';
  reason: string | null;
  states: ReadBackItem[];
  events: ReadBackItem[];
  transitions: ReadBackItem[];
  functions: ReadBackItem[];
};

export type ReadBack = {
  schema: string;
  name: string;
  feature: string | null;
  summary: string;
  sentences: ReadBackSentence[];
  types: { id: string; text: string }[];
  counts: { sentences: number; covered: number; outOfScope: number; uncovered: number; types: number };
};

export type GenerateResult = {
  status: 'generated';
  feature: string;
  written: string[];
  updated: string[];
  skipped: string[];
  tests: { unchanged: string[]; missingDependencies: string[] };
};

export type LoadError = { ok: false; error: string };
export type LoadReport = { ok: true; report: MachineSpecReport } | LoadError;
export type LoadReadBack = { ok: true; readBack: ReadBack } | LoadError;
export type RunGenerate = { ok: true; result: GenerateResult } | LoadError;

/** One block row: a state, event, transition or function, flattened out of the read-back's per-sentence groups
 * (deduped by id) since the read-back is the only place the server hands the UI the spec's content today. */
export type SpecRowGroup = 'states' | 'events' | 'transitions' | 'functions';
export type SpecRow = { id: string; group: SpecRowGroup; text: string; req: string[] };
