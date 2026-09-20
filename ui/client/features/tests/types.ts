// Shapes of ui/server's /api/tests (testsApi.mjs, src/engine/testClone.mjs) and the Tests screen's view state.
// The Cockpit only reads these; every scenario, branch, hash and refusal sentence comes from Construct's core.

/** What a generated test's header records (and a clone copies): where it came from, for staleness later (#306). */
export type TestLineage = {
  feature: string | null;
  machine: string | null;
  machineFile: string | null;
  machineKey: string | null;
  scenario: string | null;
  title: string | null;
  route: string | null;
  machineHash: string | null;
  scenarioHash: string | null;
  clonedFrom: { file: string; scenario: string } | null;
};

import type { Freshness } from './domain/FreshnessShapes.ts';
export type * from './domain/FreshnessShapes.ts';
export type * from './domain/RunShapes.ts';

export type GeneratedTest = { name: string; path: string; lineage: TestLineage; area: 'generated'; locked: true };
export type YourTest = { name: string; path: string; lineage: TestLineage | null; clonedFrom: { file: string; scenario: string } | null; kind: 'clone' | 'authored'; area: 'yours'; locked: false; freshness?: Freshness };

/** One scenario of the feature's flow and whether a test covers it. `lastResult` is always 'none' until tests run as processes (#305). */
export type CoverageRow = {
  n: number;
  id: string;
  machine: string;
  title: string;
  branch: string;
  route: string;
  text: string[];
  needs: string[];
  generated: boolean;
  file: string | null;
  locked: boolean;
  outOfDate: boolean;
  cloned: string[];
  /** Clones of this scenario whose flow has changed under them (#306). */
  staleClones?: string[];
  lastResult: 'none';
};


export type TestsListing = {
  ok: true;
  feature: string;
  lock: { declared: boolean; message: string | null };
  generated: GeneratedTest[];
  yours: YourTest[];
  coverage: CoverageRow[];
  scenarios: number;
  skipped: { file: string; machine: string; reason: string }[];
  truncated: boolean;
  coverageError: string | null;
  /** Can Playwright launch here? `missing` means `npx playwright install chromium` has not been run on this machine. */
  environment?: { browsers: 'installed' | 'missing' };
};

/** One piece of a scenario sentence: plain text, an emphasised state name, or a code name. */
export type InlinePart = { kind: 'text' | 'em' | 'code'; text: string };

export type TestArea = 'generated' | 'yours';
export type TestSelection = { area: TestArea; name: string };

/** The clone dialog. `reason` is why it opened (a button, or an attempted edit of one step). */
export type CloneDialog = { source: string; title: string; hash: string | null; steps: number; reason: string; name: string; busy: boolean; error: string | null };

/** The dialog plus what is derived from it: the slug the server will check, where it lands and what is recorded. */
export type CloneDialogView = CloneDialog & { slug: string; savedAs: string; lineageNote: string };

export type CloneResult = { ok: true; path: string; name: string } | { ok: false; error: string; code?: string; suggested?: string | null };
export type GenerateResult = { ok: true; written: string[]; unchanged: string[] } | { ok: false; error: string; code?: string };
export type SourceResult = { ok: true; text: string; path: string; locked: boolean } | { ok: false; error: string };

export type TestsLoad = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: TestsListing };
export type CodeView = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; path: string; text: string };
export type GenerateState = { status: 'idle' } | { status: 'running' } | { status: 'error'; message: string } | { status: 'done'; written: number };

export type TestsState = {
  feature: string;
  load: TestsLoad;
  selected: TestSelection | null;
  code: CodeView;
  dialog: CloneDialog | null;
  generate: GenerateState;
  notice: string | null;
};

export type TestsAction =
  | { type: 'PICK_FEATURE'; feature: string }
  | { type: 'LOADING' }
  | { type: 'LOADED'; data: TestsListing }
  | { type: 'FAILED'; message: string }
  | { type: 'SELECT'; selection: TestSelection | null }
  | { type: 'CODE_LOADING' }
  | { type: 'CODE_READY'; path: string; text: string }
  | { type: 'CODE_FAILED'; message: string }
  | { type: 'CODE_HIDE' }
  | { type: 'OPEN_DIALOG'; dialog: Omit<CloneDialog, 'busy' | 'error'> }
  | { type: 'EDIT_NAME'; name: string }
  | { type: 'CLOSE_DIALOG' }
  | { type: 'CLONE_START' }
  | { type: 'CLONE_FAILED'; error: string; suggested?: string | null }
  | { type: 'CLONE_DONE'; name: string; path: string }
  | { type: 'GENERATE_START' }
  | { type: 'GENERATE_DONE'; written: number }
  | { type: 'GENERATE_FAILED'; message: string }
  | { type: 'DISMISS_NOTICE' };

// ---- the step document (#302): one of YOUR tests as GIVEN / AND / WHEN / THEN / CHECK rows, and its editor state.
// Shapes of ui/server /api/tests/:feature/steps (src/engine/testSteps.mjs); the server re-validates every field on write.

/** What a step IS (the fields that reach the test file). `note` is the comment above it. */
export type StepFields =
  | { kind: 'fixme'; text: string }
  | { kind: 'goto'; url: string | null }
  | { kind: 'state'; state: string; timeout?: number; note?: string }
  | { kind: 'event'; event: string; testId: string; note?: string }
  | { kind: 'check-text'; text: string; timeout: number; note?: string };
export type StepKind = StepFields['kind'];
/** A step as the server describes it: its fields, its keyword, its sentence and the selector it binds to. */
export type StepRow = StepFields & { keyword: string; sentence: string; binding: string };
export type MachineInfo = { key: string; id: string; initial: string | null; events: { event: string; testId: string; label: string }[]; states: string[] };
export type StepDocBase = { name: string; path: string; hash: string; kind: 'clone' | 'authored'; lineage: TestLineage | null };
export type StepDocResult =
  | ({ ok: true; editable: true; title: string; steps: StepRow[]; machine: MachineInfo } & StepDocBase)
  | ({ ok: true; editable: false; reason: string } & StepDocBase)
  | { ok: false; error: string; code?: string };
export type DiffRow = { kind: 'context' | 'added' | 'removed' | 'gap'; oldLine?: number; newLine?: number; text: string; hidden?: number };
export type StepPreviewResult =
  | { ok: true; changed: boolean; baseHash: string; resultSha: string; diff: { rows: DiffRow[]; stats: { added: number; removed: number } } }
  | { ok: false; error: string; code?: string };
export type StepSaveResult = { ok: true; hash: string } | { ok: false; error: string; code?: string };

/** One row being edited. `origin` is the row's index in the file as opened (null = added now); `removed` rows stay visible until saved. */
export type DraftStep = { key: number; origin: number | null; removed: boolean; step: StepFields };
export type StepChange = 'added' | 'removed' | 'changed' | null;

export type StepReview =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; resultSha: string; changed: boolean; rows: DiffRow[]; added: number; removed: number }
  | { status: 'saving' }
  | { status: 'error'; message: string; stale: boolean };

export type StepEditorState =
  | { status: 'idle' }
  | { status: 'loading'; name: string }
  | { status: 'error'; message: string }
  | { status: 'readonly'; name: string; path: string; reason: string }
  | { status: 'editing'; name: string; path: string; hash: string; title: string; machine: MachineInfo; original: StepFields[]; draft: DraftStep[]; selected: number | null; nextKey: number; review: StepReview; announce: string; notice: string | null };

export type StepEditorAction =
  | { type: 'OPEN'; name: string }
  | { type: 'LOADED'; doc: StepDocResult; notice?: string | null }
  | { type: 'CLOSE' }
  | { type: 'SELECT'; key: number }
  | { type: 'PATCH'; key: number; patch: Partial<StepFields> }
  | { type: 'ADD'; kind: 'event' | 'state' | 'check-text' }
  | { type: 'REMOVE'; key: number }
  | { type: 'RESTORE'; key: number }
  | { type: 'MOVE'; key: number; dir: -1 | 1 }
  | { type: 'DISCARD' }
  | { type: 'REVIEW_START' }
  | { type: 'REVIEW_READY'; resultSha: string; changed: boolean; rows: DiffRow[]; added: number; removed: number }
  | { type: 'REVIEW_FAILED'; message: string; stale: boolean }
  | { type: 'REVIEW_BACK' }
  | { type: 'SAVE_START' };

/** One row of the step document as drawn: words, selector, code preview and what it can do. */
export type StepRowView = {
  key: number;
  /** 1-based position among the rows that stay; null for a removed row. */
  n: number | null;
  keyword: string;
  sentence: string;
  binding: string;
  code: string;
  note: string;
  change: StepChange;
  changeLabel: string;
  removed: boolean;
  step: StepFields;
  canEdit: boolean;
  canUp: boolean;
  canDown: boolean;
};
