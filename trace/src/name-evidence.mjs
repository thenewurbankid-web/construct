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
//
// LIN-108 addition (`storyNames`/`storyBestByName`, below): a second evidence source, a story.md's prose instead
// of the design's own label. Unlike `nameSimilarity`/`bestByName` above, this one DOES narrow match.mjs's
// candidate list — but only behind `storyEvidence`, an explicit off-by-default flag (see match.mjs), because it
// carries the exact risk `narrowByName` was rejected for. Off by default until a Delivery/Matching Engine Lead
// review of the measured eval numbers says otherwise.

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

// LIN-108: the same shape as bestByName above, for a different evidence source — a story.md's prose instead of
// the design's own label. See src/match.mjs's `storyEvidence` flag (off by default) for how this is wired, and
// its file-header risk note there for why it defaults off: the "coupled" eval category shuffles k identical
// fields' identity against k similarly-named columns specifically so a name-based auto-pick is right only by
// chance, and a story mentioning a field's name carries the exact same risk bestByName's own header describes.

/**
 * The distinct name-like word tokens a story.md's raw text mentions, canonicalised the same way a candidate or
 * design name is (see `tokensOf` above). Deliberately NOT limited to any heading — real example story.md files
 * are plain prose with no `## Goal` / `## Acceptance criteria` structure (see `src/ai/context.mjs`'s
 * `loadStory`, which parses those headings for the separate AI/Qwen path and is mostly empty on real stories).
 *
 * @param {string} storyText Raw story.md text (or "").
 * @returns {string[]} Canonical word tokens (lower-case, deduplicated, order kept).
 */
export function storyNames(storyText) {
  return [...new Set(tokensOf(storyText))];
}

/**
 * The one candidate, among a tied set, whose field name the story text uniquely supports — or `null` when the
 * story gives no evidence, or two (or more) candidates are equally well supported (a real tie by story evidence
 * too). Mirrors `bestByName`'s contract exactly: `null` means "do not narrow", never a guess.
 *
 * Conservative on purpose: a candidate's name is "supported" only when EVERY one of its own word tokens appears
 * among the story's tokens (whole-token match, no substring leniency like `nameSimilarity`'s containment case —
 * a story's prose is noisier than a design label, so this stays stricter).
 *
 * @param {object[]} candidates Already-tied candidates (same match cost).
 * @param {string} storyText Raw story.md text (or "").
 * @param {(c: object) => string|null|undefined} nameOf The name to compare each candidate against.
 * @returns {object|null} The favoured candidate (by reference, from `candidates`), or `null`.
 */
export function storyBestByName(candidates, storyText, nameOf) {
  const names = storyNames(storyText);
  if (candidates.length < 2 || !names.length) return null;
  const scored = candidates.map((c) => {
    const toks = new Set(tokensOf(nameOf(c) ?? ""));
    if (!toks.size) return { c, score: 0 };
    const hit = [...toks].filter((t) => names.includes(t)).length;
    return { c, score: hit / toks.size };
  });
  const max = Math.max(...scored.map((s) => s.score));
  if (max <= 0) return null;
  const best = scored.filter((s) => s.score === max);
  return best.length === 1 ? best[0].c : null;
}
