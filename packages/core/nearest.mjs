// The nearest known id to an unknown one ("Did you mean ...?"), shared by architecture.yml's unknown-rule error
// (config.mjs) and Line's refusals for an unknown item, feature or name (bench-gaps, im2: a refusal that names no
// nearest match left a small model unable to repair it). Deterministic: Levenshtein distance, case-insensitive, a
// substring bonus (a typo'd prefix or suffix), a fixed threshold, and alphabetical order on a tie.

/**
 * Edit distance between two strings (insert, delete, substitute; each costs 1).
 * @param {string} a @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  const m = a.length; const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

/** Line's fixed threshold: at most this share of the longer id may differ (and at least 2 edits are allowed). */
export const NEAREST_MAX_SHARE = 0.4;

/**
 * The known id closest to `unknown`, or null when none is close enough.
 * @param {string} unknown What was asked for.
 * @param {Iterable<string>} known The ids that exist.
 * @param {{maxDistance?: number}} [o] `maxDistance`: a fixed cap on the score; default
 *   max(2, round(NEAREST_MAX_SHARE x the longer length)) per candidate; Infinity always answers.
 * @returns {string|null}
 */
export function closestId(unknown, known, o = {}) {
  const u = String(unknown ?? '').toUpperCase();
  if (!u) return null;
  let best = null; let bestScore = Infinity;
  for (const id of [...known].sort()) {
    const k = String(id).toUpperCase();
    const bonus = k.includes(u) || u.includes(k) ? -2 : 0;
    const score = levenshtein(u, k) + bonus;
    const cap = o.maxDistance ?? Math.max(2, Math.round(NEAREST_MAX_SHARE * Math.max(u.length, k.length)));
    if (score > cap) continue;
    if (score < bestScore) { bestScore = score; best = id; }
  }
  return best;
}
