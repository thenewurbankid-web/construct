// #596 (part of #373 / #561) -- the Notes API: durable, per-project drafts on this machine. Persistence is
// `notesStore.mjs` (atomic writes, `rev` optimistic concurrency, 256 KiB cap); this file only maps HTTP onto it.
// No model is called anywhere on this path.
//
// Security and contract, in one place:
//   - mounted below the session gate AND the project-open gate (`requireProject`, index.mjs), so nothing here
//     runs with no project open (409 NO_PROJECT) or with a project whose root escapes the workspace;
//   - the client never names a path: notes live at `<stateDir>/notes/<projectKey>/<id>.json`, the key derived
//     on the server from the open project, and the id is sanitised again by the store (`fileFor`);
//   - a mutating request from a foreign browser Origin is refused (403); POST/PUT bodies must be JSON (415);
//   - own body parser (1 MiB) because a note may be 256 KiB and the app-wide `express.json()` stops at 100 KB;
//     index.mjs steps that global parser aside for `/api/notes`;
//   - `PUT` carries the `rev` the client saved against in `If-Match` (or `rev` in the body). Missing: 400
//     REV_REQUIRED; stale: 409 STALE_REV with the current copy in `current`, so the client can offer
//     Keep mine / Load theirs / Compare without a second round trip. Nothing is silently overwritten;
//   - a note that already `ran` is read-only history (409 NOTE_RAN); `POST /:id/duplicate` copies it to iterate.
//     `status: 'ran'` and `processId` are not settable from a client: only Run (a later slice) sets them.
import express from 'express';
import { openNotesStore, NotesStoreError, NOTE_STATUSES } from './notesStore.mjs';

export const MAX_NOTES_REQUEST_BYTES = '1mb';
const CLIENT_SETTABLE_STATUS = new Set([...NOTE_STATUSES].filter((s) => s !== 'ran'));
const PREVIEW_CHARS = 140;

const fail = (status, code, error, extra = {}) => ({ status, body: { ok: false, code, error, ...extra } });

/** The list row: everything except the (up to 256 KiB) body and the plan itself. */
export function summarize(note) {
  const flat = String(note.body ?? '').replace(/\s+/g, ' ').trim();
  return {
    id: note.id,
    title: note.title,
    preview: flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}...` : flat,
    status: note.status,
    rev: note.rev,
    hasPlan: note.plan != null,
    planStale: note.planStale === true,
    processId: note.processId ?? null,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/** `If-Match: 3`, `"3"` or `W/"3"` -> 3; anything else -> undefined (the store answers REV_REQUIRED / STALE_REV). */
export function revFromHeader(value) {
  if (typeof value !== 'string') return undefined;
  const m = /^\s*(?:W\/)?"?(\d+)"?\s*$/.exec(value);
  return m ? Number(m[1]) : undefined;
}

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
const bodyOf = (req) => (isPlain(req.body) ? req.body : {});

/** Field validation shared by create and update. Returns an error result or null. */
function checkFields({ title, body, plan, status }, { allowStatus }) {
  if (title !== undefined && typeof title !== 'string') return fail(400, 'BAD_FIELD', 'title must be text.');
  if (body !== undefined && typeof body !== 'string') return fail(400, 'BAD_FIELD', 'body must be text.');
  if (plan !== undefined && plan !== null && typeof plan !== 'object') return fail(400, 'BAD_FIELD', 'plan must be an object, a list or null.');
  if (status !== undefined) {
    if (!allowStatus) return fail(400, 'BAD_FIELD', 'status can only be set when a note is saved.');
    if (typeof status !== 'string' || !NOTE_STATUSES.has(status)) return fail(400, 'INVALID_STATUS', `Unknown note status. Expected one of: ${[...CLIENT_SETTABLE_STATUS].join(', ')}.`);
    if (!CLIENT_SETTABLE_STATUS.has(status)) return fail(400, 'STATUS_NOT_SETTABLE', 'A note becomes "ran" only when its plan is run; it cannot be set here.');
  }
  return null;
}

/**
 * @param {{getRoot: () => {ok:true, root:string} | {ok:false, status?:number, body?:object}, clientOrigin?: string, stateDir?: string, now?: () => string}} deps
 *   `getRoot` names the open project; the two optional deps are test seams (state directory, clock).
 */
export function createNotesRouter({ getRoot, clientOrigin, stateDir, now }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (req.method !== 'GET') {
      const origin = req.get('origin');
      if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, error: 'This request came from a page that is not the Cockpit.' });
    }
    return next();
  });
  router.use(express.json({ limit: MAX_NOTES_REQUEST_BYTES }));
  router.use((req, res, next) => {
    if ((req.method === 'POST' || req.method === 'PUT') && !req.is('application/json')) return res.status(415).json({ ok: false, error: 'Send a JSON body.' });
    return next();
  });

  const handle = (fn) => (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(r.status ?? 400).json(r.body ?? { ok: false, error: r.error ?? 'No project is open.' });
    const store = openNotesStore(r.root, { ...(stateDir ? { stateDir } : {}), ...(now ? { now } : {}) });
    try {
      const out = fn(store, req);
      return res.status(out.status).json(out.body);
    } catch (e) {
      if (e instanceof NotesStoreError) {
        // A stale write hands the client the copy it lost to, so "Load theirs" and "Compare" need no second call.
        const extra = e.code === 'STALE_REV' ? { current: store.get(req.params.id) } : {};
        return res.status(e.status).json({ ok: false, code: e.code, error: e.message, ...extra });
      }
      // An unwritable state directory (disk full, permissions) is a state the client shows with Retry, not a crash.
      const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
      if (code === 'ENOSPC') return res.status(507).json({ ok: false, code: 'DISK_FULL', error: 'The disk is full, so the note could not be saved.' });
      if (code === 'EACCES' || code === 'EROFS' || code === 'EPERM') return res.status(500).json({ ok: false, code: 'NOT_WRITABLE', error: 'The notes folder is not writable.' });
      return res.status(500).json({ ok: false, code: 'NOTES_FAILED', error: 'The notes could not be read or saved.' });
    }
  };

  router.get('/', handle((store) => {
    const { notes, problems } = store.list();
    return { status: 200, body: { ok: true, notes: notes.map(summarize), unreadable: problems.length } };
  }));

  router.post('/', handle((store, req) => {
    const { title, body, plan, status } = bodyOf(req);
    const bad = checkFields({ title, body, plan, status }, { allowStatus: false });
    if (bad) return bad;
    const note = store.create({ title, body, plan });
    return { status: 201, body: { ok: true, note } };
  }));

  router.get('/:id', handle((store, req) => {
    const note = store.get(req.params.id);
    return note ? { status: 200, body: { ok: true, note } } : fail(404, 'NOT_FOUND', `No such note "${req.params.id}".`);
  }));

  router.put('/:id', handle((store, req) => {
    const b = bodyOf(req);
    const bad = checkFields(b, { allowStatus: true });
    if (bad) return bad;
    const rev = revFromHeader(req.get('if-match')) ?? (b.rev === undefined ? undefined : Number(b.rev));
    const current = store.get(req.params.id);
    if (!current) return fail(404, 'NOT_FOUND', `No such note "${req.params.id}".`);
    if (current.status === 'ran') return fail(409, 'NOTE_RAN', 'This note already ran, so it is read-only history. Duplicate it to iterate.', { current });
    const note = store.update(req.params.id, { rev, title: b.title, body: b.body, plan: b.plan, status: b.status });
    return { status: 200, body: { ok: true, note } };
  }));

  router.post('/:id/duplicate', handle((store, req) => {
    const source = store.get(req.params.id);
    if (!source) return fail(404, 'NOT_FOUND', `No such note "${req.params.id}".`);
    const note = store.create({ title: source.title ? `${source.title} (copy)` : '', body: source.body });
    return { status: 201, body: { ok: true, note } };
  }));

  router.delete('/:id', handle((store, req) => (store.remove(req.params.id)
    ? { status: 200, body: { ok: true, removed: req.params.id } }
    : fail(404, 'NOT_FOUND', `No such note "${req.params.id}".`))));

  // A body the parser refused (bad JSON, over the request limit) gets a fixed answer that never echoes the body.
  router.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
      return res.status(err.type === 'entity.too.large' ? 413 : 400).json({ ok: false, code: err.type === 'entity.too.large' ? 'TOO_LARGE' : 'BAD_JSON', error: err.type === 'entity.too.large' ? 'That note is too large to save.' : 'The request body was not valid JSON.' });
    }
    return next(err);
  });
  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
