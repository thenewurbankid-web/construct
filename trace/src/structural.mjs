// Structural-coincidence rules: matches that are right for a reason the DATA cannot vouch for.
//
// The matcher accepts one explanation when exactly one transform reproduces the design's text. Some explanations
// reproduce it because of how mock data is built, not because they are what the design means:
//   count-equals-row-count       "8" is the size of the mock list, so count() matches whatever the "8" was counting
//   sequence-equals-id-or-index  1, 2, 3, 4 is the row number, and an auto-increment id runs 1, 2, 3, 4 too
//   extremum-is-overall-extreme  the design's "largest open" is the largest of ALL rows in the mock data
//   small-number-from-envelope   a bare small whole number equals some scalar of the response envelope by chance
// Each detector is a pure function of its input and returns `{ pattern, reason }` (the reason is plain words for
// questions, hints and reports) or null. They only FLAG; whether a flagged match is asked about is decided in
// src/structural-gate.mjs, with the design's label words (src/evidence.mjs). No model, no randomness, no clock.
//
// Every detector takes the same input object; the fields it needs are listed with it:
//   candidate  the matcher's single candidate: { field, formatter } for a row, { agg, field, formatter } for a value
//   examples   the design's text for the part: one per designed row, or [the value's example]
//   items      the mock list's items, flattened, in API order            values   `items` values of candidate.field
//   itemCount  how many items the mock list has

const trimText = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
const q = (v) => JSON.stringify(v);

/**
 * `count()` of the list, matched by a page value.
 *
 * @param {{candidate: object, examples: string[], itemCount: number}} input The part and the mock list.
 * @returns {{pattern: string, reason: string}|null} A flag when the candidate is a count.
 *
 * @example
 * countEqualsRowCount({ candidate: { agg: "count", formatter: "asText" }, examples: ["8"], itemCount: 8 }).pattern; // => "count-equals-row-count"
 */
export function countEqualsRowCount({ candidate, examples, itemCount }) {
  if (candidate?.agg !== "count") return null;
  return {
    pattern: "count-equals-row-count",
    reason: `the design shows ${q(trimText(examples[0]))}, which is exactly how many rows the mock list has (${itemCount}); a count of the list always matches that, even if the design counts only some of the rows (open, active, ...)`,
  };
}

// "1", "2", "3" / "01", "02" / "#1", "#2": a running number that starts at 0 or 1 and goes up by one.
function runningNumbers(texts) {
  if (texts.length < 2) return null;
  const nums = texts.map((t) => /^#?\s*0*(\d+)$/.exec(trimText(t))?.[1]);
  if (nums.some((n) => n == null)) return null;
  const n = nums.map(Number);
  return (n[0] === 0 || n[0] === 1) && n.every((x, i) => x === n[0] + i) ? n : null;
}
const ID_LIKE = /^(id|_id|uid|uuid|index|idx|key|pk)$/i;

/**
 * A row column whose design text is a running number (1, 2, 3 ...) matched by a field that is an auto-increment
 * id, or any field that runs in steps of one down the whole list (the row index in disguise).
 *
 * @param {{candidate: object, examples: string[], values: any[]}} input `values` is the candidate field over ALL items, in API order.
 * @returns {{pattern: string, reason: string}|null} A flag when both the design and the field are running numbers.
 *
 * @example
 * sequenceEqualsIdOrIndex({ candidate: { field: "id" }, examples: ["1", "2", "3"], values: [1, 2, 3, 4] }).pattern; // => "sequence-equals-id-or-index"
 */
export function sequenceEqualsIdOrIndex({ candidate, examples, values }) {
  if (!candidate?.field || candidate.agg) return null;
  const seq = runningNumbers(examples);
  if (!seq) return null;
  const nums = (values ?? []).map((v) => (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v)) ? Number(v) : NaN));
  const runs = nums.length >= seq.length && nums.every((x, i) => Number.isInteger(x) && x === nums[0] + i);
  const leaf = String(candidate.field).split(".").pop();
  if (!runs && !ID_LIKE.test(leaf)) return null;
  return {
    pattern: "sequence-equals-id-or-index",
    reason: `the design shows a running number (${seq.slice(0, 4).join(", ")}${seq.length > 4 ? ", ..." : ""}) and ${q(candidate.field)} ${runs ? "also runs one by one down the mock list" : "is an id"}, so it matches the row order whatever the column means (a rank, a position, a row number)`,
  };
}

/**
 * `max` or `min` of a field over the whole list.
 *
 * @param {{candidate: object, items: object[]}} input The part and the mock list.
 * @returns {{pattern: string, reason: string}|null} A flag when the candidate is a max or a min.
 *
 * @example
 * extremumIsOverallExtreme({ candidate: { agg: "max", field: "balance" }, items: [{ balance: 3 }, { balance: 9 }] }).pattern; // => "extremum-is-overall-extreme"
 */
export function extremumIsOverallExtreme({ candidate, items }) {
  if (candidate?.agg !== "max" && candidate?.agg !== "min") return null;
  const vals = (items ?? []).map((it) => Number(it[candidate.field]));
  const at = vals.indexOf(candidate.agg === "max" ? Math.max(...vals) : Math.min(...vals));
  return {
    pattern: "extremum-is-overall-extreme",
    reason: `the design's value is the ${candidate.agg === "max" ? "largest" : "smallest"} ${q(candidate.field)} of ALL ${vals.length} mock rows (row ${at + 1}); if the design means the ${candidate.agg === "max" ? "largest" : "smallest"} of some rows only (open, active, ...), the overall one can match by chance`,
  };
}

/**
 * A bare small whole number (up to three digits) matched to one scalar of the response envelope.
 *
 * @param {{candidate: object, examples: string[]}} input The part.
 * @returns {{pattern: string, reason: string}|null} A flag for `agg: "field"` candidates with a bare small integer.
 *
 * @example
 * smallNumberFromEnvelope({ candidate: { agg: "field", field: "meta.total" }, examples: ["21"] }).pattern; // => "small-number-from-envelope"
 */
export function smallNumberFromEnvelope({ candidate, examples }) {
  if (candidate?.agg !== "field") return null;
  const t = trimText(examples[0]);
  if (!/^\d{1,3}$/.test(t)) return null;
  return {
    pattern: "small-number-from-envelope",
    reason: `the design shows the bare number ${q(t)} and the response field ${q(candidate.field)} holds it, but a small whole number equals some field of a response by chance often`,
  };
}

/** The detectors, in rule order: the first that fires names the flag. */
export const DETECTORS = [countEqualsRowCount, sequenceEqualsIdOrIndex, extremumIsOverallExtreme, smallNumberFromEnvelope];
export const PATTERNS = ["count-equals-row-count", "sequence-equals-id-or-index", "extremum-is-overall-extreme", "small-number-from-envelope"];

/**
 * Runs the detectors on one accepted part.
 *
 * @param {object} input See the module header: candidate, examples, items, values, itemCount.
 * @returns {{pattern: string, reason: string}|null} The first flag, or null when no rule fires.
 */
export function detectStructural(input) {
  for (const d of DETECTORS) {
    const hit = d(input);
    if (hit) return hit;
  }
  return null;
}

// What would close a flagged part, per rule (plain words; used by hints.mjs for the open item's next step).
export const NEXT_STEP = {
  "count-equals-row-count": "Confirm it if the design counts every row. If it counts only some of them (open, active, ...), answer with a placeholder, or give the API a field or endpoint for that count.",
  "sequence-equals-id-or-index": "Confirm it if the column really shows the id. If it is a rank or a row number, answer with a placeholder, or give the API a field with those values.",
  "extremum-is-overall-extreme": "Confirm it if the design means the overall extreme. If it means the extreme of some rows only, answer with a placeholder, or give the API that value.",
  "small-number-from-envelope": "Confirm it if that response field is what the design shows. Otherwise pick another explanation, or answer with a placeholder.",
};
