// Typed mirror of the Line Cockpit contract (packages/engine/line/contract.mjs) as the client reads it from
// GET /api/line/project, plus the view models this feature renders. Change the contract first, then here.

export type LineKind = 'components' | 'pages' | 'workflows' | 'fixtures';
export type Level = 'atom' | 'molecule' | 'organism';

/** One finding: the plain-English sentence first, the technical part separate (for a Details view). */
export type LineFinding = { sentence: string; rule: string; severity: 'error' | 'warning' | 'info'; file: string; line: number };

export type LibraryItem = {
  id: string;
  kind: LineKind;
  name: string;
  file: string;
  /** Components only. */
  level?: Level;
  usedBy: { feature: string; file: string }[];
};

export type FeatureItem = {
  id: string;
  kind: LineKind;
  name: string;
  feature: string;
  file: string;
  base: { value: string | null; libraryId: string | null };
  status: 'ok' | 'problem';
  findings: LineFinding[];
};

export type LineFeature = { name: string; spec: string | null; items: FeatureItem[] };

export type LineProject = {
  isLine: boolean;
  layout: { library: string; features: string; state: string };
  library: LibraryItem[];
  features: LineFeature[];
  findings: LineFinding[];
};

/** What the service answers: the project, or one sentence saying why not. */
export type LineProjectResult = { ok: true; project: LineProject } | { ok: false; sentence: string };

/** The service's surface, so the real API and its mock are interchangeable. */
export type LineApi = { getLineProject: () => Promise<LineProjectResult> };

// ---- View models -------------------------------------------------------------------------------

export type LibraryCard = {
  id: string;
  name: string;
  level: Level;
  levelLabel: string;
  file: string;
  usedByCount: number;
  /** "Used by 2 feature components" / "Not used by any feature yet". */
  usedByText: string;
};

export type LibraryGroup = { level: Level; title: string; hint: string; cards: LibraryCard[] };

export type FeatureComponentRow = {
  id: string;
  name: string;
  file: string;
  /** "Based on Button", "No library base yet", "Based on components/Nope, which is not in the library". */
  baseText: string;
  linked: boolean;
  problem: boolean;
  findings: LineFinding[];
};

export type FeatureSection = { name: string; rows: FeatureComponentRow[] };

export type LibraryView = { total: number; groups: LibraryGroup[]; features: FeatureSection[] };

/** What the Components screen renders for a load state (domain/LibraryView.ts screenFor). */
export type LineScreen = { kind: 'loading' } | { kind: 'fallback' } | { kind: 'line'; view: LibraryView };

export type LineProjectEvent = { type: 'LOAD' } | { type: 'LOADED'; project: LineProject } | { type: 'FAILED'; sentence: string };

export type LineProjectState =
  | { status: 'loading' }
  | { status: 'error'; sentence: string }
  | { status: 'ready'; project: LineProject };
