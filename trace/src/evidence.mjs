// Label evidence: do the design's words for a part agree with the candidate field's name?
//
// Pure and deterministic: no model, no clock, no randomness. Lexical only. It splits camelCase / snake_case,
// lowercases, applies a light plural stem, drops stop words, and folds words through ONE small synonym table
// (src/evidence.synonyms.json). It cannot know intent: "openCount" and count() share the word "count", and
// the leftover word "open" is exactly what makes the verdict `neutral`.
//
// Evidence NEVER accepts anything on its own. The structural gate (src/structural-gate.mjs) only asks it how
// to handle a candidate that already tripped a structural detector (src/structural.mjs):
//   supports     every content word of the design's label is explained by the candidate  -> keep the accept, record why
//   contradicts  the label has words, the candidate has words, and none of them meet     -> ask
//   neutral      some words meet, or the design has no words for it                       -> ask
import fs from "node:fs";

const SYN = JSON.parse(fs.readFileSync(new URL("./evidence.synonyms.json", import.meta.url), "utf8"));
const STOP = new Set(["a", "an", "and", "as", "by", "for", "from", "in", "is", "of", "or", "per", "the", "to", "with", "your", "my", "all", "current"]);
// Words for "one of the things in the list": they carry no meaning about WHICH thing.
const GENERIC = new Set(["item", "entry", "record", "row", "result"]);

/**
 * A light plural stem: "categories" -> "category", "items" -> "item", "status" stays.
 *
 * @param {string} w A lowercase word.
 * @returns {string} The stem.
 */
export function stem(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (/(ss|us|is)$/.test(w)) return w;
  if (w.length > 4 && /(ches|shes|xes|zes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 2 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}

// word (stemmed) -> the first word of its synonym group
const CANON = new Map();
for (const g of SYN.groups) for (const w of g) CANON.set(stem(w.toLowerCase()), stem(g[0].toLowerCase()));
const canon = (w) => CANON.get(w) ?? w;

/**
 * The content words of a text, canonical: split on case changes, `_`, `.`, spaces and punctuation, lowercased,
 * stemmed, stop words and bare numbers dropped, synonyms folded to one word. Order is kept, duplicates removed.
 *
 * @param {string} text A field path ("spend.value"), a data-dyn name ("openCount") or a label ("Close on").
 * @returns {string[]} Canonical words.
 *
 * @example
 * tokenize("openCount"); // => ["open", "count"]
 * tokenize("Total spend"); // => ["amount"]
 */
export function tokenize(text) {
  return pairs(text).map((p) => p.c);
}

// [{ w: the word as the design wrote it (stemmed, lower-case), c: its canonical synonym-group word }], duplicates by `c` removed.
function pairs(text) {
  const spaced = String(text ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/#/g, " # ");
  const out = [];
  for (const raw of spaced.split(/[^A-Za-z0-9#]+/)) {
    const w = raw.toLowerCase();
    if (!w || /^\d+$/.test(w) || STOP.has(w)) continue;
    const s = stem(w);
    if (GENERIC.has(s)) continue;
    if (s.length < 2 && !CANON.has(s)) continue;
    const c = canon(s);
    if (!out.some((p) => p.c === c)) out.push({ w: s, c });
  }
  return out;
}

const firstSentence = (s) => String(s ?? "").split(/(?<=[.!?])\s/)[0];

/**
 * The words a candidate offers: its field path, an aggregate's name, the list's subject noun for a count, and
 * (when the contract has them) the field's OpenAPI title and the first sentence of its description.
 *
 * @param {object} candidate A matcher candidate: `{field, formatter}` for a row, `{agg, field, formatter}` for a value.
 * @param {{docs?: Object<string,{title?:string, description?:string}>, subject?: string}} [ctx] `docs` by field name
 *   (path or last segment); `subject` the words for what a row is (the list's name, its first column's header).
 * @returns {string[]} Canonical words.
 */
export function candidateWords(candidate, { docs = {}, subject = "" } = {}) {
  const parts = [];
  if (candidate.agg && candidate.agg !== "field") parts.push(candidate.agg);
  if (candidate.agg === "count") parts.push(subject);
  if (candidate.field) parts.push(candidate.field);
  const d = docs[candidate.field] ?? docs[String(candidate.field ?? "").split(".").pop()];
  if (d) parts.push(d.title ?? "", firstSentence(d.description));
  return [...new Set(tokenize(parts.join(" ")))];
}

/**
 * The design's words for a part (see src/labels.mjs): the designer's own name for it (data-dyn) and the column
 * header. The text next to it and the card title above it are used only when those give no words at all: text
 * between two data parts belongs to either of them ("7 high · 13 medium" puts "high" right before the medium
 * count), so as a requirement it produced false alarms in the corpus.
 *
 * @param {{name?:string, header?:string, inline?:string, label?:string}} label What the design says.
 * @returns {{words: string[], shown: string[], source: "name"|"nearby"|"none"}} Canonical words, the same words as the design wrote them, and where they came from.
 */
export function labelWords(label = {}) {
  const own = pairs([label.name, label.header].filter(Boolean).join(" "));
  const chosen = own.length ? own : pairs([label.inline, label.label].filter(Boolean).join(" "));
  return { words: chosen.map((p) => p.c), shown: chosen.map((p) => p.w), source: own.length ? "name" : chosen.length ? "nearby" : "none" };
}

/**
 * Do the design's words support the candidate?
 *
 * @param {{label: object, candidate: object, docs?: object, subject?: string}} args `label` as in labelWords.
 * @returns {{verdict: "supports"|"contradicts"|"neutral", score: number, matched: string[], unmatched: string[], label: string[], candidate: string[], source: string}}
 *   `score` is the share of the label's words the candidate explains (0..1, two decimals). `label`, `matched` and
 *   `unmatched` are the design's own words (stemmed); `candidate` is the field's words, canonical.
 *
 * @example
 * evidence({ label: { name: "rank" }, candidate: { field: "id", formatter: "asText" } }).verdict; // => "contradicts"
 */
export function evidence({ label, candidate, docs = {}, subject = "" }) {
  const { words, shown, source } = labelWords(label);
  const cand = candidateWords(candidate, { docs, subject });
  const hit = words.map((w) => cand.includes(w));
  const matched = shown.filter((_, i) => hit[i]);
  const unmatched = shown.filter((_, i) => !hit[i]);
  const score = words.length ? Math.round((matched.length / words.length) * 100) / 100 : 0;
  const verdict = !words.length || !cand.length ? "neutral" : !unmatched.length ? "supports" : !matched.length ? "contradicts" : "neutral";
  return { verdict, score, matched, unmatched, label: shown, candidate: cand, source };
}

/**
 * One plain sentence for a verdict, for questions, hints and the badge.
 *
 * @param {ReturnType<typeof evidence>} e An evidence result.
 * @returns {string} The sentence.
 */
export function describeEvidence(e) {
  if (!e.label.length) return "the design has no words for it, so its name gives no evidence either way";
  const q = (a) => a.map((w) => `"${w}"`).join(", ");
  if (e.verdict === "supports") return `the design's words (${q(e.label)}) are all explained by the field name`;
  if (e.verdict === "contradicts") return `none of the design's words (${q(e.label)}) appear in the field name`;
  if (!e.matched.length) return `the field name gives no words to compare with ${q(e.label)}`;
  return `the field name explains ${q(e.matched)} but not ${q(e.unmatched)}`;
}
