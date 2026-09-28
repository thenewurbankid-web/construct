// T12.5: lexical name evidence for a tied question (ask.mjs). Deterministic, no model: token overlap on
// camelCase/snake/kebab-split words, plus substring containment.
//
// IMPORTANT — what this deliberately does NOT do: it never narrows match.mjs's candidate list and never turns
// a tie into an accepted match. Measured attempt: an earlier version of this file exported `narrowByName`,
// which match.mjs called to auto-resolve a tie when exactly one candidate's name stood out, removing the
// question. `npm run eval:gate` failed it: headline oracle_accuracy dropped (0.9656 -> 0.9644, tolerance 0)
// and the "coupled" category's wrong_accept_rate went from 0 to 0.0278 (tolerance 0.02) — that category
// (eval/generate.mjs's `coupled` generator) exists exactly to build k identical-valued API fields with their
// identity SHUFFLED against k similarly-named design columns, so a name-based auto-pick is right only by
// chance. That is a real conflict with README's "Never a guess. Exact matches are not asked; ties are always
// asked" — flagged rather than silently resolved either way (see the T12 builder report). This module now
// only helps ask.mjs present a tie better (option order, a "closest name match" label): it never changes which
// parts are asked about or what a saved answer resolves to, so it carries no eval risk.
//
// Checked against Construct (CLAUDE.md's reuse list) before writing this: nothing in packages/ast, core or
// engine offers string/name similarity, so there is nothing to reuse here.

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// "spendYouManage" -> ["spend", "you", "manage"]; "spend_you-manage" -> the same.
const tokensOf = (s) => String(s ?? "")
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .split(/[^A-Za-z0-9]+/)
  .map((t) => t.toLowerCase())
  .filter(Boolean);

/**
 * Lexical similarity between two names (e.g. a design field's name and a candidate API field's name).
 * Not a general-purpose string metric: tuned to reward exact and substring matches over loose token overlap,
 * so a coincidental shared word never outweighs one name literally containing the other.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} `0` (no shared evidence) to `1` (identical once case/punctuation is normalized).
 */
export function nameSimilarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.75;
  const ta = new Set(tokensOf(a)), tb = new Set(tokensOf(b));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  if (!inter) return 0;
  const union = new Set([...ta, ...tb]).size;
  return 0.5 * (inter / union); // token overlap alone can never reach a substring match's score
}

/**
 * The one candidate, among a tied set, whose name evidence against `designName` is strictly better than every
 * other candidate's — or `null` when there is no evidence, or two candidates score equally (a real tie by name
 * too). This is presentation-only evidence for a question that is asked either way (see the file header):
 * callers use it to order options and label the suggestion, never to skip asking.
 *
 * @param {object[]} candidates Already-tied candidates (same match cost).
 * @param {string|null|undefined} designName The design's name for the part (e.g. a row field's `dyn` name).
 * @param {(c: object) => string|null|undefined} nameOf The name to compare each candidate against.
 * @returns {object|null} The favoured candidate (by reference, from `candidates`), or `null`.
 */
export function bestByName(candidates, designName, nameOf) {
  if (candidates.length < 2 || !designName) return null;
  const scored = candidates.map((c) => ({ c, score: nameSimilarity(designName, nameOf(c)) }));
  const max = Math.max(...scored.map((s) => s.score));
  if (max <= 0) return null;
  const best = scored.filter((s) => s.score === max);
  return best.length === 1 ? best[0].c : null;
}
