// The view models and service surface of the Components screen. The Line contract's shapes come from the one shared
// mirror (lib/lineContract.ts, lib/lineHttp.ts).
import type { ApplyResult, BaseOnRequest, Level, LineFinding, LineProject, PromoteRequest } from '@/lib/lineContract';

export type * from '@/lib/lineContract';

/** What the service answers: the project, or one sentence saying why not. */
export type LineProjectResult = { ok: true; project: LineProject } | { ok: false; sentence: string };

/** The service's surface, so the real API and its mock are interchangeable. */
export type LineApi = {
  getLineProject: () => Promise<LineProjectResult>;
  baseOn: (req: BaseOnRequest) => Promise<ApplyResult>;
  promote: (req: PromoteRequest) => Promise<ApplyResult>;
};

/** The one change being prepared or sent: a new feature item based on a library card, or a promotion. */
export type ChangeState =
  | { status: 'idle' }
  | { status: 'base-on'; libraryId: string; libraryName: string; feature: string; name: string; error: string | null }
  | { status: 'base-on-saving'; libraryId: string; libraryName: string; feature: string; name: string }
  | { status: 'promote'; featureItemId: string; name: string; error: string | null }
  | { status: 'promote-saving'; featureItemId: string; name: string };

export type ChangeEvent =
  | { type: 'OPEN_BASE_ON'; libraryId: string; libraryName: string; feature: string; name: string }
  | { type: 'SET_FEATURE'; feature: string; name: string }
  | { type: 'SET_NAME'; name: string }
  | { type: 'OPEN_PROMOTE'; featureItemId: string; name: string }
  | { type: 'CANCEL' }
  | { type: 'SUBMIT' }
  | { type: 'DONE'; result: ApplyResult };

/** What the library page needs to offer "Base on this" and "Promote to library". */
export type ChangeControls = {
  change: ChangeState;
  notice: ApplyResult | null;
  features: string[];
  openBaseOn: (libraryId: string, libraryName: string) => void;
  setFeature: (feature: string) => void;
  setName: (name: string) => void;
  openPromote: (featureItemId: string, name: string) => void;
  cancel: () => void;
  submit: () => void;
};

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
  /** Line cu6: outside the project's workspace folder, so Line will not change it (domain/ReadOnly.ts). */
  readOnly?: boolean;
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
  /** What "Promote to library" will do, said before anything is written. */
  promoteText: string;
  findings: LineFinding[];
  /** Line cu6: outside the project's workspace folder, so Line will not change it (domain/ReadOnly.ts). */
  readOnly?: boolean;
};

export type FeatureSection = { name: string; rows: FeatureComponentRow[] };

export type LibraryView = {
  total: number;
  groups: LibraryGroup[];
  features: FeatureSection[];
  /** Every feature folder, for the "Base on this" picker. */
  featureNames: string[];
};

/** What the Components screen renders for a load state (domain/LibraryView.ts screenFor). */
export type LineScreen = { kind: 'loading' } | { kind: 'fallback' } | { kind: 'line'; view: LibraryView };

export type LineProjectEvent = { type: 'LOAD' } | { type: 'LOADED'; project: LineProject } | { type: 'FAILED'; sentence: string };

export type LineProjectState =
  | { status: 'loading' }
  | { status: 'error'; sentence: string }
  | { status: 'ready'; project: LineProject };
