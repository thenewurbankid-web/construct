export type DashboardId = string;

/** Every command endpoint on ui/server responds with this same envelope
 * (see ui/server/src/index.mjs / commandRunner.mjs) — deterministic tool
 * output, then, distinctly, whatever LLM involvement (if any) happened. */
export type CommandResult = {
  ok: boolean;
  output?: string[];
  attribution?: { tool: string; llm: string } | null;
  /** Whole-command wall-clock total, in seconds (#167) -- a floor
   * guarantee independent of whatever per-step timing text the command
   * itself already printed into `output` (see #165/#166). */
  durationSeconds?: number;
  error?: string;
};

export type CreateInput = {
  kind: 'feature' | 'layer' | 'single';
  name: string;
  feature?: string;
  layer?: string;
  layers?: string[];
  /** Opt in to an LLM-written implementation; the provider comes from Settings' createFill. */
  useLlm?: boolean;
};

export type RefactorInput = {
  action: 'move' | 'rename';
  name: string;
  newName?: string;
  feature: string;
  from?: string;
  to?: string;
  layer?: string;
};

export type ResearchInput = {
  action: 'summarize' | 'doctor';
  feature?: string;
  format?: string;
  since?: string;
};

export type ImportInput = {
  mode: 'unit' | 'plan';
  name?: string;
  feature?: string;
  layers?: string[];
  from?: string;
  planPath?: string;
  llm?: string;
  /** Opt in to an LLM-written fill; the provider comes from Settings' importFill. */
  useLlm?: boolean;
};
