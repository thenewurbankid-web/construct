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

export type GeneratedTest = { name: string; path: string; lineage: TestLineage; area: 'generated'; locked: true };
export type YourTest = { name: string; path: string; lineage: TestLineage | null; clonedFrom: { file: string; scenario: string } | null; kind: 'clone' | 'authored'; area: 'yours'; locked: false };

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
