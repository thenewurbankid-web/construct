// Durable Notes (#596, #373): the shapes every layer shares. Server shapes are ui/server's notesApi.mjs; the screen
// state is what NotesMachine.ts reduces.

export type NoteStatus = 'draft' | 'plan-ready' | 'ran';

/** A whole note, as `GET/PUT /api/notes/:id` return it. */
export type Note = {
  id: string;
  title: string;
  body: string;
  plan: unknown;
  status: NoteStatus;
  rev: number;
  createdAt: string;
  updatedAt: string;
  processId: string | null;
  planStale?: boolean;
};

/** One row of `GET /api/notes`: the list never carries the note text. */
export type NoteRow = {
  id: string;
  title: string;
  preview: string;
  status: NoteStatus;
  rev: number;
  hasPlan: boolean;
  planStale: boolean;
  processId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** What the editor holds while you type. */
export type Draft = { title: string; body: string };

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; at: string }
  /** `code` is the server's (`DISK_FULL`, `TOO_LARGE`, `NOT_WRITABLE`, `UNREACHABLE`...). */
  | { status: 'failed'; message: string; code: string }
  /** Someone else saved first: `theirs` is the copy on disk, the one thing nothing overwrites. */
  | { status: 'conflict'; theirs: Note };

export type ListState = { status: 'idle' | 'loading' | 'ready' | 'failed'; rows: NoteRow[]; error: string | null };

export type ScreenState = {
  list: ListState;
  /** The last server copy of the open note (its `rev` is what the next save is made against). */
  note: Note | null;
  draft: Draft;
  save: SaveState;
  comparing: boolean;
  confirmingDelete: boolean;
  /** The open note could not be read (deleted elsewhere, unreadable file). */
  openError: string | null;
};

export type ScreenAction =
  | { type: 'LIST_LOADING' }
  | { type: 'LIST_LOADED'; rows: NoteRow[] }
  | { type: 'LIST_FAILED'; error: string }
  | { type: 'LIST_UPSERT'; row: NoteRow }
  | { type: 'LIST_REMOVE'; id: string }
  | { type: 'OPENED'; note: Note }
  | { type: 'OPEN_FAILED'; error: string }
  | { type: 'CLOSED' }
  | { type: 'EDIT'; edit: Partial<Draft> }
  | { type: 'SAVE_STARTED' }
  | { type: 'SAVE_OK'; note: Note; sent: Draft }
  | { type: 'SAVE_CONFLICT'; theirs: Note }
  | { type: 'SAVE_FAILED'; message: string; code: string }
  | { type: 'KEEP_MINE' }
  | { type: 'LOAD_THEIRS' }
  | { type: 'TOGGLE_COMPARE' }
  | { type: 'CONFIRM_DELETE'; on: boolean };

/** What a service call answers: a value or a plain reason. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

/** The outcome of a save, so the hook can tell a routine conflict from a failure. */
export type SaveResult =
  | { kind: 'ok'; note: Note }
  | { kind: 'conflict'; current: Note }
  | { kind: 'failed'; message: string; code: string };

/** One line of the Compare view. */
export type CompareLine = { key: number; kind: 'same' | 'mine' | 'theirs'; text: string };
