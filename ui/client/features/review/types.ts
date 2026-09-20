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
  line?: number;
  rule?: string;
  layer?: string | null;
  constraint?: { layer: string; canImport: string[] | null } | null;
  why?: string;
  suggestedFix?: string;
  /** Present on mechanical findings: the Construct command that resolves it, and whether it exists yet. */
  fix?: { via: string; available: boolean; why?: string };
};

/** The evidence the blast-radius indicator carries (declared vs touched, both directions). */
export type BlastEvidence = {
  declared: { features: string[]; files: string[] } | null;
  touched: { features: string[]; directories?: string[] };
  extraFeatures?: string[];
  unreachedFeatures?: string[];
  extraFiles?: { items: string[]; total: number };
  missingFiles?: { items: string[]; total: number };
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
  evidence?: unknown;
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
  /** The saved plan this change was compared with (#316), or null: no plan is the normal case. */
  plan?: { id: string; title: string } | null;
  report?: ChangeReport;
  units?: UnitSummary[];
  unitsOmitted?: number;
  error?: { code: string; message: string };
};

/** A saved plan the change can be compared with (the processes' plans, from /api/review/plans). */
export type PlanChoice = { id: string; title: string; state: string; features: string[]; files: number };

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

export type * from './domain/FindingsTypes.ts';
export type * from './domain/WorkflowTypes.ts';
