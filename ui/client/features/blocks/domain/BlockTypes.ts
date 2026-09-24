// Blocks (#407): the shapes every layer shares. Server shapes are ui/server's blocksApi.mjs / blockCatalogue.mjs; the
// screen state is what BlocksMachine.ts reduces. Nothing here is a model call: the catalogue is the deterministic
// registry of blocks, described in plain words by the server.

export type Engine = 'mechanical' | 'ai';
export type Executor = 'deterministic' | 'local-model' | 'user';

export type BlockArg = {
  name: string;
  type: 'string' | 'string[]' | 'boolean' | 'object';
  required: boolean;
  enum?: string[];
  description?: string;
  /** The value is a path inside the project. */
  path: boolean;
};

/** The settings of one block in this project, defaults filled in. */
export type BlockSettings = { enabled: boolean; engine: Engine | null; provider: string | null; model: string | null };

/** A concrete example step of a block: the step to drop into a plan, and the command it stands for. */
export type BlockExample = {
  title: string;
  flow: string;
  executor: Executor;
  args: Record<string, unknown>;
  touches?: { features: string[] };
  argv: string[] | null;
};

/** One row of `GET /api/blocks`. */
export type BlockRow = {
  id: string;
  purpose: string;
  reads: string;
  /** What it writes, or null for a read-only block. */
  writes: string | null;
  writesFiles: boolean;
  /** `none` = model calls: 0. `optional` = it can use a model when a step asks for one. */
  modelCalls: 'none' | 'optional';
  engines: Engine[];
  scope: 'empty' | 'derived' | 'declared';
  offered: boolean;
  notOffered?: string;
  args: BlockArg[];
  example: BlockExample | null;
  settings: BlockSettings;
  runs: number;
};

/** What `GET /api/blocks` and a successful `PUT` answer. */
export type BlocksData = {
  rev: number;
  updatedAt: string | null;
  /** Why the settings file could not be read, or null. While set, the server refuses every plan (fail closed). */
  unreadable: string | null;
  provider: string;
  engines: Engine[];
  blocks: BlockRow[];
};

/** The settings a person can change on one block; `null` puts a field back to its default. */
export type BlockPatch = { enabled?: boolean; engine?: Engine | null; model?: string | null };

export type LoadResult = { ok: true; data: BlocksData } | { ok: false; error: string };
export type SaveResult = { ok: true; data: BlocksData } | { ok: false; code: string; error: string; current?: BlocksData };

/** What "Run this block" hands the Plan screen: one step, ready to add. The plan validates it like any other step. */
export type BlockRunRequest = {
  flow: string;
  title: string;
  executor: Executor;
  args: Record<string, unknown>;
  touches?: { features: string[] };
};

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** The server said no to a change; `id` is the block it was about. */
export type Refusal = { id: string | null; code: string; message: string };

export type ScreenState = {
  status: LoadStatus;
  error: string | null;
  rev: number;
  unreadable: string | null;
  provider: string;
  blocks: BlockRow[];
  filter: string;
  /** The block whose change is being saved. */
  saving: string | null;
  refusal: Refusal | null;
};

export type ScreenAction =
  | { type: 'LOAD_START' }
  | { type: 'LOADED'; data: BlocksData }
  | { type: 'LOAD_FAILED'; error: string }
  | { type: 'FILTER'; text: string }
  | { type: 'SAVE_START'; id: string | null }
  | { type: 'SAVED'; data: BlocksData }
  | { type: 'SAVE_REFUSED'; id: string | null; code: string; message: string; current?: BlocksData };
