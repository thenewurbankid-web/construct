// #373 (part of #367, drives story #561) — durable, per-project Notes.
//
// Persistence only; the HTTP surface is `notesApi.mjs` (`GET/POST /api/notes`, `GET/PUT/DELETE
// /api/notes/:id`, #596) and the Cockpit screen is `ui/client/features/notes`.
//
// Same pattern as `packages/engine/processStore.mjs` (processes) and
// `ui/server/src/settings.mjs` (last-open project): state lives OUTSIDE the
// project, in the per-user state directory, keyed by the project's absolute
// path via `resolveStateDir()` / `projectKey()`. Reusing those two helpers
// (rather than re-deriving a key) is what keeps this store's layout
// consistent with everything else already on disk under `<stateDir>/`.
//
// Layout:
//   <stateDir>/notes/<projectKey>/<noteId>.json
//
// Per-login keying: NOT done here, and deliberately so. #567 (per-user
// workspace directory, part of #566) is not implemented yet — there is no
// `currentLogin()` helper in workspace.mjs to key on. Once #567 lands,
// `workspaceRoot()` becomes request-scoped to `<root>/<login>/...`, so every
// open project's absolute path already lives under that user's own
// directory — `projectKey(projectRoot)` (which hashes the absolute path)
// then separates users' notes for free, with no change needed here. This
// mirrors `processStore.mjs`, which has the exact same non-problem today.
//
// Atomic writes: reuses `atomicWriteJson` from processStore.mjs (temp file
// in the same directory, `fsync`, then `rename()` — a process killed
// mid-save leaves either the old record or the new one, never a partial
// file at the normal read path), rather than re-implementing it.
//
// Optimistic concurrency: every save bumps `rev`. `update(id, { rev, ... })`
// requires the caller's `rev` to match the record currently on disk;
// mismatch is a distinct, catchable error (`NotesStoreError` with
// `status: 409, code: 'STALE_REV'`) — the server side of the "409, Keep
// mine / Load theirs" contract the client UI (not this slice) will offer.
// A missing/absent `rev` on update is a *different* error (400
// `REV_REQUIRED`): the client never loaded, or forgot to resend, the rev it
// saved against, which is a client bug, not a routine conflict — the same
// missing-vs-stale split `pagesEditor.mjs`'s `assertContentHash` (#590) and
// `componentsApi.mjs`'s `componentSave` already use for content hashes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveStateDir, projectKey, atomicWriteJson } from '../../../packages/engine/processStore.mjs';

/** Note body cap (#373): a note's content is capped at 256 KiB. Enforced on both `create` and
 * `update`, so a note can never be saved over the cap by either path. */
export const MAX_NOTE_BODY_BYTES = 256 * 1024;

/** The known `status` values a note may carry (design: `docs/design/ia-five-screens.md` section 7,
 * issue #367's "Notes storage" note). `draft` (default) -> `plan-ready` (a plan was generated for
 * it, not attempted in this slice) -> `ran` (Run copied it into a process record). Validated here so
 * a route layer built on top of this store cannot persist a typo'd status silently. */
export const NOTE_STATUSES = new Set(['draft', 'plan-ready', 'ran']);

export class NotesStoreError extends Error {
  /** @param {string} message @param {{status?: number, code?: string}} [opts] */
  constructor(message, { status = 400, code } = {}) {
    super(message);
    this.name = 'NotesStoreError';
    this.status = status;
    this.code = code;
  }
}

/** Absolute directory holding one project's note records: `<stateDir>/notes/<projectKey>`. */
export function notesDir(projectRoot, { stateDir = resolveStateDir() } = {}) {
  return path.join(stateDir, 'notes', projectKey(projectRoot));
}

function fileFor(dir, id) {
  return path.join(dir, `${String(id).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}

function assertBodyWithinCap(body) {
  const bytes = Buffer.byteLength(typeof body === 'string' ? body : String(body ?? ''), 'utf8');
  if (bytes > MAX_NOTE_BODY_BYTES) {
    throw new NotesStoreError(
      `Note content is ${bytes} bytes, over the ${MAX_NOTE_BODY_BYTES}-byte (256 KiB) cap.`,
      { status: 413, code: 'TOO_LARGE' },
    );
  }
}

function assertKnownStatus(status) {
  if (status !== undefined && !NOTE_STATUSES.has(status)) {
    throw new NotesStoreError(
      `Unknown note status "${status}". Expected one of: ${[...NOTE_STATUSES].join(', ')}.`,
      { status: 400, code: 'INVALID_STATUS' },
    );
  }
}

/**
 * Open the store for one project, mirroring `openProcessStore`'s shape: a small bound object rather
 * than free functions, so a caller passes the project root and the state directory once. A second
 * `openNotesStore()` call against the same `projectRoot`/`stateDir` (e.g. after a simulated server
 * restart) reads back exactly what an earlier instance wrote — there is no in-memory cache here, the
 * directory listing on disk IS the store.
 *
 * @param {string} projectRoot The project the notes belong to.
 * @param {object} [options]
 * @param {string} [options.stateDir] Base state directory (defaults to `resolveStateDir()`).
 * @param {() => string} [options.now] Clock (ISO string) — a test seam.
 */
export function openNotesStore(projectRoot, { stateDir = resolveStateDir(), now = () => new Date().toISOString() } = {}) {
  const dir = notesDir(projectRoot, { stateDir });

  /** Read one note file. Returns `{ note, problem }` — a corrupt file is reported, not thrown, so
   * `list()` can skip it and keep going (same shape as processStore.mjs's `readFile`). */
  const readFile = (file) => {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      return { note: null, problem: { file, id: path.basename(file, '.json'), reason: `unreadable: ${e.message}` } };
    }
    return { note: parsed, problem: null };
  };

  const store = {
    dir,
    projectRoot: path.resolve(projectRoot),

    /** Create a note. Assigns a fresh id and `rev: 1`; `status` defaults to `draft`, `plan` to
     * `null` (whatever shape the caller hands in for `plan` is stored as-is — no plan-generation
     * logic lives here). Throws `NotesStoreError` (413 `TOO_LARGE`, 400 `INVALID_STATUS`) rather
     * than silently truncating or coercing. */
    create({ title = '', body = '', plan = null, status = 'draft', processId = null } = {}) {
      assertKnownStatus(status);
      assertBodyWithinCap(body);
      const id = crypto.randomUUID();
      const createdAt = now();
      const record = { id, title: String(title), body: String(body), plan, status, rev: 1, createdAt, updatedAt: createdAt, processId, planStale: false };
      atomicWriteJson(fileFor(dir, id), record);
      return record;
    },

    /** One note by id, or `null` if there is no such record. Throws `NotesStoreError` (500
     * `UNREADABLE`) if the file exists but is not valid JSON — a caller asking for one specific note
     * wants to know it is broken, unlike `list()`. */
    get(id) {
      const file = fileFor(dir, id);
      if (!fs.existsSync(file)) return null;
      const { note, problem } = readFile(file);
      if (problem) throw new NotesStoreError(`Note "${id}" is unreadable on disk — ${problem.reason}`, { status: 500, code: 'UNREADABLE' });
      return note;
    },

    /** Every note for this project, newest-updated first. `problems` lists files that could not be
     * read, so one corrupt record cannot hide the rest of the list. */
    list() {
      if (!fs.existsSync(dir)) return { notes: [], problems: [] };
      const notes = [];
      const problems = [];
      for (const name of fs.readdirSync(dir).sort()) {
        if (!name.endsWith('.json')) continue; // excludes atomicWriteJson's `<id>.json.tmp-<pid>-<ts>` temp files
        const { note, problem } = readFile(path.join(dir, name));
        if (problem) problems.push(problem);
        else notes.push(note);
      }
      notes.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return { notes, problems };
    },

    /**
     * Update a note with optimistic-concurrency: the caller's `rev` must equal the record's current
     * `rev` on disk, or the write is refused (this is the server half of the "409, Keep mine / Load
     * theirs" contract; picking between them is the client UI's job, not this slice's).
     *
     * @throws {NotesStoreError} 404 `NOT_FOUND` — no such note.
     * @throws {NotesStoreError} 400 `REV_REQUIRED` — `rev` missing (a client bug: it never loaded, or
     *   forgot to resend, the rev it saved against — distinct from a routine stale write).
     * @throws {NotesStoreError} 409 `STALE_REV` — `rev` present but does not match the note on disk
     *   (someone/something else saved first — routine, "reload and try again").
     * @throws {NotesStoreError} 413 `TOO_LARGE` / 400 `INVALID_STATUS` — same validation as `create`.
     */
    update(id, { rev, title, body, plan, status, processId } = {}) {
      const file = fileFor(dir, id);
      if (!fs.existsSync(file)) {
        throw new NotesStoreError(`No such note "${id}".`, { status: 404, code: 'NOT_FOUND' });
      }
      const { note: current, problem } = readFile(file);
      if (problem) throw new NotesStoreError(`Note "${id}" is unreadable on disk — ${problem.reason}`, { status: 500, code: 'UNREADABLE' });
      if (rev === undefined || rev === null || rev === '') {
        throw new NotesStoreError('rev is required to save — reload the note and try again.', { status: 400, code: 'REV_REQUIRED' });
      }
      if (Number(rev) !== current.rev) {
        throw new NotesStoreError('This note changed elsewhere since it was loaded — reload it and try again (or keep yours).', { status: 409, code: 'STALE_REV' });
      }
      assertKnownStatus(status);
      const nextBody = body !== undefined ? String(body) : current.body;
      assertBodyWithinCap(nextBody);
      const nextTitle = title !== undefined ? String(title) : current.title;
      // #596 plan freshness: editing the text after a plan exists marks the plan "Out of date" (never
      // regenerated silently); saving a plan alongside clears the mark. Records written before this field
      // existed read as fresh.
      const textChanged = nextBody !== current.body || nextTitle !== current.title;
      const planStale = plan !== undefined ? false : textChanged && current.plan != null ? true : current.planStale === true;
      const next = {
        ...current,
        title: nextTitle,
        body: nextBody,
        planStale,
        ...(plan !== undefined ? { plan } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(processId !== undefined ? { processId } : {}),
        rev: current.rev + 1,
        updatedAt: now(),
      };
      atomicWriteJson(file, next);
      return next;
    },

    /** Remove a note. Returns `true` if there was one, `false` otherwise (mirrors
     * `processStore.mjs`'s `remove`). */
    remove(id) {
      const file = fileFor(dir, id);
      if (!fs.existsSync(file)) return false;
      fs.rmSync(file);
      return true;
    },
  };

  return store;
}
