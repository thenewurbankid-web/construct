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

// #223 scope/binding links: the server graph (core buildScopeLinks) and the view model derived from it.
export type ScopeDeclKind = 'prop' | 'state' | 'setter';

export type ScopeLinkGraph = {
  nodeId: string;
  tag: string;
  isCustomComponent: boolean;
  scope: { name: string; kind: ScopeDeclKind }[];
  links: { prop: string; valueKind: 'literal' | 'identifier' | 'expression'; text: string; from: { name: string; kind: ScopeDeclKind }[] }[];
  spreads: { text: string; from: { name: string; kind: ScopeDeclKind }[] }[];
  childProps: { name: string; status: 'bound' | 'spread' | 'unbound' }[] | null;
  undeclared: string[];
  suggestions: string[];
  unusedScope: string[];
  childPropsResolved: boolean;
};

export type ScopeSourceItem = { name: string; kind: ScopeDeclKind; color: string; linked: boolean; unusedInPage: boolean };

export type ScopeTargetStatus = 'bound' | 'literal' | 'unbound' | 'spread' | 'undeclared';

export type ScopeTargetItem = {
  prop: string;
  status: ScopeTargetStatus;
  /** How the value is written, e.g. `count + 1`, `"hi"`; empty for props nobody passes. */
  text: string;
  /** Colour of the first linked source, or null when the prop is not fed by a scope name. */
  color: string | null;
  /** True when the (closed) child declares this prop. */
  declared: boolean;
};

export type ScopeEdge = { from: string; to: string; color: string };

export type ScopeFlag = { level: 'warn' | 'info'; text: string };

export type ScopeView = {
  tag: string;
  sources: ScopeSourceItem[];
  targets: ScopeTargetItem[];
  edges: ScopeEdge[];
  flags: ScopeFlag[];
  childPropsResolved: boolean;
};

/** One contiguous run of unchanged/added/removed lines from a before/after
 * diff (#81) — `added`/`removed` both falsy means unchanged context. */
export type DiffHunk = { value: string; added?: boolean; removed?: boolean };

/** One row of a rendered before/after diff (#224), pre-computed server-side. */
export type DiffRow = {
  kind: 'context' | 'added' | 'removed' | 'gap';
  oldLine?: number;
  newLine?: number;
  text: string;
  hidden?: number;
};

/** A page file last external (on-disk, non-editor) change (#224). */
export type PageChange = {
  at: number;
  beforeHash: string;
  afterHash: string;
  stats: { added: number; removed: number };
  rows: DiffRow[];
};
