export type PagesEditorId = string;

export type PropKind = 'string' | 'number' | 'boolean' | 'identifier' | 'expression' | 'spread';

// #77 follow-up to #53 — `name` is null for a spread prop (`{...rest}` has
// no attribute name); `index` is its 0-based position in the opening tag's
// attribute list, needed to identify *which* spread to edit server-side
// since name-based lookup doesn't work for it (see PropsApi.tsx).
export type PropData = { name: string | null; kind: PropKind; value: unknown; index: number };

export type PagesEditorNode = {
  id: string;
  tag: string;
  isFragment: boolean;
  isCustomComponent: boolean;
  props: PropData[];
  children: PagesEditorNode[];
};

export type PageTree = { roots: PagesEditorNode[]; contentHash: string };

// Source view (Monaco adapter contract + diagnostics), editor-neutral.
export type DiagnosticSource = 'typescript' | 'architecture' | 'separation-of-concerns';
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/** One diagnostic as returned by GET /api/pages/source (1-based positions). */
export type SourceDiagnostic = {
  source: DiagnosticSource;
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
};

/** Editor-neutral marker (1-based, end exclusive), message pre-labelled. */
export type SourceMarker = {
  severity: DiagnosticSeverity;
  message: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  code: string;
  source: DiagnosticSource;
};

export type DiagnosticSummary = { errors: number; warnings: number; infos: number; total: number };

/** The whole contract an editor adapter implements (Monaco, textarea, ...).
 * `onChange` is optional: omit it (with readOnly) for a viewer. */
export type SourceEditorProps = {
  value: string;
  markers: SourceMarker[];
  readOnly?: boolean;
  onChange?: (value: string) => void;
  /** Accessible label / stable test hook. */
  label?: string;
};

export type Violation = { rule: string; severity: string; message: string };

export type SaveOutcome = { ok: boolean; error?: string; violations?: Violation[] };

export type StatusMessage = { ok: boolean; message: string; violations?: Violation[] };

/** One contiguous run of unchanged/added/removed lines from a before/after
 * diff (#81) — `added`/`removed` both falsy means unchanged context. */
export type DiffHunk = { value: string; added?: boolean; removed?: boolean };
