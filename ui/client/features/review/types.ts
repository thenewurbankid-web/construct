// Shapes of ui/server's /api/review (reviewApi.mjs) and of the PR-health report it carries
// (schemas/pr-health.v1.json, src/engine/prHealth.mjs). The Cockpit only reads these; every number
// and sentence shown comes from the engine, never from anything decided here.

export type IndicatorId = 'blast-radius' | 'unexplained' | 'rule-regressions' | 'public-surface' | 'flow-diff';
export type IndicatorStatus = 'clear' | 'info' | 'attention' | 'not-measured';

/** One indicator as the list needs it (a finished report, slimmed by the server). */
export type IndicatorSlim = {
  id: IndicatorId;
  title: string;
  status: IndicatorStatus;
  measured: boolean;
  headline: string;
  findings: number;
};

/** A finished analysis of one branch, as the list shows it. */
export type AnalysisDone = {
  state: 'done';
  summary: string;
  files: number;
  features: { name: string; files: number }[];
  findings: number;
  counts: { mechanical: number; conversation: number };
  scope: { declared: number; touched: number } | null;
  indicators: IndicatorSlim[];
  degraded: { truncated: boolean; message?: string } | null;
};
export type Analysis =
  | { state: 'none' | 'queued' | 'running' }
  | { state: 'error'; error: { code: string; message: string } }
  | AnalysisDone;

export type BranchRow = {
  name: string;
  sha: string;
  subject: string;
  author: string;
  date: string;
  current: boolean;
  ahead: number | null;
  analysis: Analysis;
};

export type BranchList = {
  source: { id: string; label: string };
  base: string | null;
  baseSha?: string;
  current: string | null;
  refs: string[];
  branches: BranchRow[];
};

// ---- one change ----------------------------------------------------------------

export type ChangedFile = { path: string; status: 'A' | 'M' | 'D' | 'T'; feature: string | null; layer: string | null; scope: string };

export type Finding = {
  id: string;
  indicator: IndicatorId;
  resolution: 'mechanical' | 'conversation';
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  files?: string[];
};

/** One indicator of the full report: the computed sentence, where the number comes from, its findings. */
export type FullIndicator = {
  id: IndicatorId;
  title: string;
  status: IndicatorStatus;
  measured: boolean;
  headline: string;
  reason?: string;
  source: string;
  findings: Finding[];
};

export type ChangeReport = {
  ok: true;
  summary: string;
  change: { files: ChangedFile[]; features: { name: string; files: number }[]; counts: { files: number; added: number; modified: number; deleted: number } };
  indicators: FullIndicator[];
  findings: Finding[];
  counts: { mechanical: number; conversation: number };
  degraded: { truncated?: boolean; message?: string } | null;
};

export type UnitSummary = { path: string; summary: string | null; purpose?: string | null; exports?: string[] };

export type ChangeState = 'none' | 'queued' | 'running' | 'done' | 'error';
export type ChangeResponse = {
  state: ChangeState;
  base: { name: string; sha: string };
  head: { name: string; sha: string; subject: string; author: string; date: string };
  report?: ChangeReport;
  units?: UnitSummary[];
  unitsOmitted?: number;
  error?: { code: string; message: string };
};

// ---- view models ---------------------------------------------------------------

export type Tone = 'danger' | 'warn' | 'info' | 'ok' | 'neutral';
export type Badge = { id: string; text: string; tone: Tone };
export type ListOrder = 'risk' | 'newest';

/** A changed file as the tree shows it: name and status already in words. */
export type TreeFile = ChangedFile & { name: string; statusLabel: string };
export type LayerGroup = { layer: string; label: string; files: TreeFile[] };
export type FeatureGroup = { key: string; name: string; label: string; fileCount: number; layers: LayerGroup[]; outside: boolean };
export type LayerView = { layer: string; label: string; fileCount: number; files: TreeFile[] };

export type UnitRow = { path: string; name: string; layer: string; feature: string; isNew: boolean; text: string };
export type UnitsView = { rows: UnitRow[]; more: { count: number; text: string } | null };

export type GlossaryEntry = { id: string; badge: string; tone: Tone; means: string; from: string };

export type IndicatorCard = {
  id: string;
  title: string;
  statusLabel: string;
  tone: Tone;
  headline: string;
  /** Why it is not measured (only present then), in the engine's neutral words. */
  reason: string | null;
  source: string;
  findings: { id: string; title: string; resolutionLabel: string }[];
};

// ---- component props (kept here: components stay presentation-only) --------------

export type BranchRowView = {
  name: string;
  subject: string;
  meta: string;
  current: boolean;
  /** Badges once analysed; null while the analysis is queued or running. */
  badges: Badge[] | null;
  pending: string | null;
  error: string | null;
};
export type BranchListProps = {
  base: string;
  rows: BranchRowView[];
  order: ListOrder;
  explanation: string;
  onOrder: (order: ListOrder) => void;
  onOpen: (name: string) => void;
  onReload: () => void;
};
export type ReviewSourcesProps = { sourceLabel: string; base: string; baseSha: string | null; refs: string[]; count: number; onBase: (name: string) => void };
export type ChangeTreeProps = {
  grouping: 'feature' | 'layer' | 'files';
  onGrouping: (g: 'feature' | 'layer' | 'files') => void;
  totals: string;
  byFeature: FeatureGroup[];
  byLayer: LayerView[];
  flat: TreeFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
};
export type UnitSummariesProps = { rows: UnitRow[]; more: UnitsView['more']; selectedPath: string | null; onSelect: (path: string) => void };

// ---- state machine -------------------------------------------------------------

export type ListState = {
  loaded: boolean;
  error: string | null;
  data: BranchList | null;
  order: ListOrder;
};
export type ListAction =
  | { type: 'LOADED'; data: BranchList }
  | { type: 'FAILED'; error: string }
  | { type: 'ORDER'; order: ListOrder };

export type ChangeViewState = {
  status: 'loading' | 'waiting' | 'ready' | 'failed';
  data: ChangeResponse | null;
  error: string | null;
  selectedPath: string | null;
  grouping: 'feature' | 'layer' | 'files';
};
export type ChangeAction =
  | { type: 'RESET' }
  | { type: 'RESPONSE'; data: ChangeResponse }
  | { type: 'FAILED'; error: string }
  | { type: 'SELECT'; path: string | null }
  | { type: 'GROUPING'; grouping: ChangeViewState['grouping'] };
