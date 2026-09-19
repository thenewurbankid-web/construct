export type Severity = 'error' | 'warning' | 'info';

/** One rule violation as `construct validate` reports it (ui/server GET /api/validate). */
export type Violation = {
  rule: string;
  module: string;
  severity: Severity;
  file: string;
  line: number;
  message: string;
  why?: string;
  suggestedFix?: string;
};

export type SeverityCounts = { error: number; warning: number; info: number; total: number };

export type DiagnosticsStatus = 'idle' | 'running' | 'ready' | 'error';

export type DiagnosticsState = {
  status: DiagnosticsStatus;
  violations: Violation[];
  /** Total reported by the server (can exceed violations.length when truncated). */
  total: number;
  truncated: boolean;
  durationMs: number | null;
  error: string | null;
};

export type DiagnosticsAction =
  | { type: 'RUN' }
  | { type: 'RESULT'; violations: Violation[]; total: number; truncated: boolean; durationMs: number }
  | { type: 'FAIL'; error: string };

/** A page file the Pages editor can open. */
export type PageTarget = { feature: string; file: string };

export type LogLevel = 'info' | 'warn' | 'error';

export type LogEntry = { id: number; at: number; source: string; level: LogLevel; text: string };

export type DiagnosticsApi = {
  state: DiagnosticsState;
  run: () => void;
};

/** One row of the Diagnostics list, already in display form. */
export type DiagnosticRow = {
  key: string;
  severity: Severity;
  severityLabel: string;
  rule: string;
  message: string;
  location: string;
  /** Set when the row's file is a page the Pages editor can open. */
  target: PageTarget | null;
  line: number;
  ariaLabel: string;
  why?: string;
  fix?: string;
};

export type DiagnosticsViewModel = {
  summary: string;
  /** 'list' shows rows; 'clean' and 'error' are the designed empty states. */
  mode: 'list' | 'clean' | 'error';
  running: boolean;
  duration: string | null;
  /** Error text: the whole state when mode is 'error', a banner over the previous result otherwise. */
  error: string | null;
  rows: DiagnosticRow[];
};

export type DiagnosticsViewProps = {
  view: DiagnosticsViewModel;
  onRun: () => void;
  /** Called when a row that points at a page file is chosen. */
  onOpenPage: (target: PageTarget, line: number) => void;
};

export type LogRow = { id: number; time: string; source: string; level: LogLevel; text: string };

export type LogsViewProps = {
  rows: LogRow[];
  error: string | null;
  onRefresh: () => void;
  onClear: () => void;
};
