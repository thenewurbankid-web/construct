export type RuleSeverity = 'error' | 'warning' | 'off';

/** One rule as `/api/validate`'s `summary` reports it (packages/core/diagnostics.mjs summarizeViolations, #758). */
export type RuleSummaryEntry = { severity: string | null; why: string | null; name: string | null; count: number };

/** One row of the Rules list, already in display form: id, plain-words name/"why", severity and live violation count. */
export type RuleRow = {
  id: string;
  name: string;
  severity: RuleSeverity;
  /** A rule's own detection intent, from a live violation's `why`; falls back to its name when it has none yet. */
  why: string;
  count: number;
};

export type RulesStatus = 'idle' | 'running' | 'ready' | 'error';

export type RulesState = {
  status: RulesStatus;
  rows: RuleRow[];
  error: string | null;
};

export type RulesAction = { type: 'RUN' } | { type: 'RESULT'; rows: RuleRow[] } | { type: 'FAIL'; error: string };

export type RulesApi = {
  state: RulesState;
  run: () => void;
};

export type RulesViewModel = {
  /** 'list' shows rows; 'empty' is a project with no rules configured (rare); 'error' is the designed failure state. */
  mode: 'list' | 'empty' | 'error';
  summary: string;
  running: boolean;
  error: string | null;
  rows: RuleRow[];
};
