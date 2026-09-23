// A small, bounded, in-memory ring buffer of recent server/command output for
// the cockpit's Logs tab. Nothing is persisted; the oldest entries fall off.
// Kept deliberately dumb: the runners record lines, one route reads them.
//
// #569: ONE ring per signed-in login (`serverLog` is a registry of rings behind
// the same record/read/clear API), so user B's Logs tab never shows user A's
// command output, project paths or dev-server lines. The key is the request's
// `currentLogin()` (workspace.mjs): '' with no session / auth off, which is then
// the only ring and behaves exactly as the old single buffer did. Code that
// records outside a request (a dev server's child process events, a timer)
// passes the owner's login explicitly.
//
// Lines recorded with NO login context (server-internal: startup, auth, an
// error caught outside any request) land in the '' ring. With login required
// no signed-in user ever reads '', so such a line is visible to nobody: a
// context-less line cannot be proven free of user-specific content (an error
// naming a path in someone's workspace), and the Logs tab is a per-user view,
// not the server's health page. That belongs to the process's own stdout /
// stderr (the hosted deployment's logs). With auth off the single user IS the
// operator and sees everything, as before.
//
// Memory: a ring is created on a login's first record and holds at most
// MAX_ENTRIES lines of at most MAX_TEXT chars (about 1 MB of text at the very
// worst). At most MAX_LOGINS rings exist at once: past that, the ring that was
// least recently recorded to or read is dropped ('' never is), so a host with
// many sign-ins over its lifetime stays at a bounded, small footprint (about
// 64 MB at the theoretical worst, far less in practice). Entry ids come from
// ONE process-wide counter, so a login whose ring was dropped and re-created
// keeps a valid `since` cursor in an already-open Logs tab (ids only ever go
// up); the only thing an id gap reveals is that the server logged something.
import { currentLogin } from './workspace.mjs';

export const MAX_ENTRIES = 500;
export const MAX_TEXT = 2000;
/** How many logins keep a ring at once (#569); the least recently used one beyond that is dropped. */
export const MAX_LOGINS = 32;

const LEVELS = new Set(['info', 'warn', 'error']);

/**
 * One ring. `ids` is an optional `{ next }` counter shared with other rings so ids stay
 * unique and increasing across all of them (the registry below); alone, ids start at 1.
 */
export function createLogBuffer(max = MAX_ENTRIES, ids = { next: 1 }) {
  let entries = [];
  return {
    /** Adds one line. Text is coerced to a string and truncated; unknown levels become 'info'. */
    record(source, level, text, now = Date.now()) {
      const raw = typeof text === 'string' ? text : String(text);
      const clipped = raw.length > MAX_TEXT ? `${raw.slice(0, MAX_TEXT)}...` : raw;
      const entry = { id: ids.next++, at: now, source: String(source), level: LEVELS.has(level) ? level : 'info', text: clipped };
      entries.push(entry);
      if (entries.length > max) entries = entries.slice(entries.length - max);
      return entry;
    },
    /** Entries with id greater than `since` (all when omitted), oldest first. */
    read(since = 0) {
      const after = Number.isFinite(Number(since)) ? Number(since) : 0;
      return entries.filter((e) => e.id > after);
    },
    clear() {
      entries = [];
    },
  };
}

/**
 * A registry of rings, one per login, behind the single-ring API plus an optional trailing `login`
 * argument (default: the current request's login; '' outside any request). Passing a login is for
 * code that records on behalf of a user outside that user's request context (devServer.mjs).
 * @param {{ max?: number, maxLogins?: number, login?: () => string }} [options] `login` is a test seam
 */
export function createLogRegistry({ max = MAX_ENTRIES, maxLogins = MAX_LOGINS, login = currentLogin } = {}) {
  /** login -> ring, in least-recently-used order (a touched key is re-inserted at the end). */
  const rings = new Map();
  const ids = { next: 1 };
  const keyOf = (who) => (typeof who === 'string' ? who : '');

  /** The ring for `who`, refreshed as most recently used; `create` makes one when there is none. */
  function ringFor(who, create) {
    const key = keyOf(who);
    let ring = rings.get(key);
    if (ring !== undefined) {
      rings.delete(key);
    } else {
      if (!create) return null;
      ring = createLogBuffer(max, ids);
    }
    rings.set(key, ring);
    if (rings.size > maxLogins) {
      for (const stale of rings.keys()) {
        if (stale === '') continue; // the no-session ring is never dropped
        rings.delete(stale);
        break;
      }
    }
    return ring;
  }

  return {
    /** Adds one line to `who`'s ring (the current login unless given). */
    record(source, level, text, now = Date.now(), who = login()) {
      return ringFor(who, true).record(source, level, text, now);
    },
    /** `who`'s entries (the current login's unless given) with id greater than `since`; [] for a login that never recorded. */
    read(since = 0, who = login()) {
      const ring = ringFor(who, false);
      return ring ? ring.read(since) : [];
    },
    /** Forgets `who`'s entries (the current login's unless given). */
    clear(who = login()) {
      ringFor(who, false)?.clear();
    },
    /** The logins that currently keep a ring (test seam). */
    logins() {
      return [...rings.keys()];
    },
  };
}

/** The process-wide registry used by the server: one ring per login (see the header). */
export const serverLog = createLogRegistry();

/** GET /api/logs handler core: origin-guarded, returns `{ ok, entries, last }` for the caller's login. */
export function handleLogs(query, { origin, clientOrigin, log = serverLog }) {
  if (origin && origin !== clientOrigin) return { status: 403, body: { ok: false, error: 'Origin not allowed.' } };
  const since = query?.since;
  if (since !== undefined && (typeof since !== 'string' || !/^\d{1,15}$/.test(since))) {
    return { status: 400, body: { ok: false, error: 'since must be a non-negative integer.' } };
  }
  const entries = log.read(since === undefined ? 0 : Number(since));
  return { status: 200, body: { ok: true, entries, last: entries.length ? entries[entries.length - 1].id : Number(since ?? 0) } };
}
