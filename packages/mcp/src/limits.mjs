// The fixed sizes of the MCP server (#649): what a call may carry in, what it may carry out, how often it may be made, and
// the typed error every refusal ends in. Data and two small functions; nothing here reads a file or the network.

/**
 * Every bound of the server in one place, so a tool result has a fixed size and a test can name the limit it hits.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const LIMITS = Object.freeze({
  /** The most bytes one tool result may hold (32 KiB). A result that would be larger is refused, never cut in the middle. */
  outputBytes: 32 * 1024,
  /** The longest requirement sentence a call may carry. The Cockpit's requirement screen has the same limit. */
  textChars: 2000,
  /** The most answers one `placement_place` call may carry. */
  answers: 20,
  /** The largest plan (as JSON) `plan_validate` reads. */
  planBytes: 64 * 1024,
  /** The most steps of a plan that are read at all. */
  planSteps: 200,
  /** The largest question summary `decide` reads (the decision provider's own limit). */
  summaryBytes: 16 * 1024,
  /** The longest feature name or chooser id. */
  nameChars: 80,
  /** The most findings `validate` lists, whatever `limit` asks for. */
  findings: 50,
  /** How many findings `validate` lists when `limit` is not given. */
  defaultFindings: 10,
  /** The longest message or fix line of one finding. */
  lineChars: 240,
  /** The most steps of a plan preview that are listed. */
  previewSteps: 40,
  /** The most files listed for one step or one block. */
  previewFiles: 12,
  /** The most open questions and offers listed. */
  questions: 12,
  /** The most features `summarize` lists. */
  features: 25,
  /** The longest plain-text summary `summarize` returns. */
  summaryChars: 6000,
  /** The most entries of any keyed list (rules, choosers, providers) in a result. */
  keyed: 20,
  /** The tool calls a project is scanned for links that leave it: at most this many directory entries. */
  scanEntries: 50000,
});

/** How many tool calls one server answers per minute unless `--rate-limit` says otherwise. */
export const DEFAULT_RATE_PER_MINUTE = 30;

/** The most calls per minute the startup configuration may allow. */
export const MAX_RATE_PER_MINUTE = 6000;

/**
 * Every refusal a tool can end in, by name, so a client (and a test) matches on a code and never on a sentence.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  PATH_OUTSIDE_ROOT: 'PATH_OUTSIDE_ROOT',
  RATE_LIMITED: 'RATE_LIMITED',
  OUTPUT_TOO_LARGE: 'OUTPUT_TOO_LARGE',
  NOT_FOUND: 'NOT_FOUND',
  PARSE_FAILED: 'PARSE_FAILED',
  ANSWER_REFUSED: 'ANSWER_REFUSED',
  PLACEMENT_REFUSED: 'PLACEMENT_REFUSED',
  PLAN_REFUSED: 'PLAN_REFUSED',
  INVALID_SUMMARY: 'INVALID_SUMMARY',
  CONFIG_UNREADABLE: 'CONFIG_UNREADABLE',
  PROJECT_TOO_LARGE: 'PROJECT_TOO_LARGE',
  TOOL_FAILED: 'TOOL_FAILED',
});

/** A refusal with a code from `ERROR_CODES`. A tool throws it; the server turns it into `{ ok: false, error: { code, message } }`. */
export class ToolError extends Error {
  /**
   * @param {keyof typeof ERROR_CODES} code One of `ERROR_CODES`.
   * @param {string} message A sentence a person can act on, with no absolute path in it.
   * @param {Record<string, unknown>} [extra] Fixed-size extra fields for the error object (for example `retryAfterSeconds`).
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.extra = extra;
  }
}

/**
 * A token bucket: `perMinute` calls may be made at once, and one more becomes available every `60 / perMinute` seconds. Pure over
 * the clock it is given, so a test drives it without waiting.
 *
 * @param {{ perMinute?: number, now?: () => number }} [options] The rate (default `DEFAULT_RATE_PER_MINUTE`) and a millisecond clock.
 * @returns {{ take: () => { ok: true } | { ok: false, retryAfterSeconds: number }, capacity: number }} `take()` spends one token or says when the next one arrives.
 *
 * @example
 * const bucket = createTokenBucket({ perMinute: 2, now: () => 0 });
 * bucket.take(); bucket.take(); bucket.take(); // => { ok: false, retryAfterSeconds: 30 }
 */
export function createTokenBucket({ perMinute = DEFAULT_RATE_PER_MINUTE, now = Date.now } = {}) {
  const capacity = Math.max(1, Math.floor(perMinute));
  const perMs = capacity / 60000;
  let tokens = capacity;
  let last = now();
  return {
    capacity,
    take() {
      const t = now();
      tokens = Math.min(capacity, tokens + Math.max(0, t - last) * perMs);
      last = t;
      if (tokens >= 1) {
        tokens -= 1;
        return { ok: true };
      }
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)) };
    },
  };
}
