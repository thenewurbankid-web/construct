// #643 -- what must never appear in text a person, an LLM, a decision model or a trace file receives: a path and a secret.
// A leaf module (no imports) so `chooser.mjs` (which HIDES these in a summary) and `decision-trace.mjs` (which REFUSES a
// record that still holds one) share one definition and cannot drift apart. Pure: no filesystem, no network.

/**
 * What "looks like a path": an absolute path (`/x`, `C:\x`), a `~/` home path, or a `./` / `../` relative one. A summary
 * replaces every match with `[path]`; a decision trace refuses a record holding one. It is global: build a fresh `RegExp`
 * from `.source` to test with it, so no `lastIndex` state leaks between callers.
 */
export const PATH_LIKE_PATTERN = /(?<![\w.-])(?:[A-Za-z]:[\\/]|~?\/|\.\.?\/)[^\s'"`),;]+/g;

/**
 * Shapes of a secret, by name: provider tokens with a known prefix, a private key header, a JWT, a bearer credential, a
 * `key=value` assignment of something called a key/secret/token/password, and any long unbroken mix of letters and digits
 * (40 characters or more) that is not a word. Conservative on purpose: a false positive costs one refused trace, a false
 * negative leaks a credential into a file.
 */
export const SECRET_PATTERNS = Object.freeze([
  { name: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { name: 'api-key', re: /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9]{16,}/ },
  { name: 'aws-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/ },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/i },
  { name: 'assignment', re: /\b(?:api[_-]?key|secret|token|passw(?:or)?d|credential)s?\s*[:=]\s*\S{8,}/i },
  { name: 'long-token', re: /(?<![A-Za-z0-9_+/=-])(?=[A-Za-z0-9_+/=-]*\d)(?=[A-Za-z0-9_+/=-]*[A-Za-z])[A-Za-z0-9_+/=-]{40,}(?![A-Za-z0-9_+/=-])/ },
]);

/**
 * Replace every path-looking piece of a text with `[path]`, the way `chooserSummary` does.
 *
 * @param {string} text Any string.
 * @returns {string} The text with paths hidden.
 *
 * @example
 * hidePaths('open ~/notes and /etc/hosts'); // => 'open [path] and [path]'
 */
export function hidePaths(text) {
  return String(text).replace(PATH_LIKE_PATTERN, '[path]');
}

/**
 * A deep copy of a JSON-like value with every string (and key-less leaf) run through `hidePaths`. Numbers, booleans and
 * `null` are kept as they are.
 *
 * @param {any} value A JSON-like value (a summary).
 * @returns {any} The copy.
 *
 * @example
 * hidePathsDeep({ question: 'What is /x?', options: [{ id: 'a' }] }); // => { question: 'What is [path]?', options: [{ id: 'a' }] }
 */
export function hidePathsDeep(value) {
  if (typeof value === 'string') return hidePaths(value);
  if (Array.isArray(value)) return value.map(hidePathsDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hidePathsDeep(v)]));
  return value;
}

/**
 * Does the text look like a path?
 *
 * @param {string} text Any string.
 * @returns {boolean} `true` when it holds an absolute path, a `~/`, a `./` or a `../`.
 *
 * @example
 * looksLikePath('see /etc/passwd'); // => true
 * looksLikePath('read the cart'); // => false
 */
export function looksLikePath(text) {
  return new RegExp(PATH_LIKE_PATTERN.source).test(String(text));
}

/**
 * The name of the first secret shape the text matches, or `null`.
 *
 * @param {string} text Any string.
 * @returns {string | null} A `SECRET_PATTERNS` name such as `github-token`, or `null` when nothing matches.
 *
 * @example
 * looksLikeSecret('token=abcd1234efgh'); // => 'assignment'
 * looksLikeSecret('a plain sentence'); // => null
 */
export function looksLikeSecret(text) {
  const s = String(text);
  for (const { name, re } of SECRET_PATTERNS) if (re.test(s)) return name;
  return null;
}
