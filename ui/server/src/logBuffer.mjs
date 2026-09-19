// A small, bounded, in-memory ring buffer of recent server/command output for
// the cockpit's Logs tab. Nothing is persisted; the oldest entries fall off.
// Kept deliberately dumb: the runners record lines, one route reads them.

export const MAX_ENTRIES = 500;
export const MAX_TEXT = 2000;

const LEVELS = new Set(['info', 'warn', 'error']);

export function createLogBuffer(max = MAX_ENTRIES) {
  let entries = [];
  let nextId = 1;
  return {
    /** Adds one line. Text is coerced to a string and truncated; unknown levels become 'info'. */
    record(source, level, text, now = Date.now()) {
      const raw = typeof text === 'string' ? text : String(text);
      const clipped = raw.length > MAX_TEXT ? `${raw.slice(0, MAX_TEXT)}...` : raw;
      const entry = { id: nextId++, at: now, source: String(source), level: LEVELS.has(level) ? level : 'info', text: clipped };
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

/** The process-wide buffer used by the server. */
export const serverLog = createLogBuffer();

/** GET /api/logs handler core: origin-guarded, returns `{ ok, entries, last }`. */
export function handleLogs(query, { origin, clientOrigin, log = serverLog }) {
  if (origin && origin !== clientOrigin) return { status: 403, body: { ok: false, error: 'Origin not allowed.' } };
  const since = query?.since;
  if (since !== undefined && (typeof since !== 'string' || !/^\d{1,15}$/.test(since))) {
    return { status: 400, body: { ok: false, error: 'since must be a non-negative integer.' } };
  }
  const entries = log.read(since === undefined ? 0 : Number(since));
  return { status: 200, body: { ok: true, entries, last: entries.length ? entries[entries.length - 1].id : Number(since ?? 0) } };
}
