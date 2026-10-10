// Acceptance criteria for a variant, judged against the baseline with a paired bootstrap over cases (the same
// resample for both variants; see stats.mjs). A variant opts in with `acceptance: {...}` in eval/variants.mjs.
//
//   wrong_accept_reduction  relative drop of the wrong-accept rate must be at least this (0.5 = halve it)
//   recall_drop_max         recall may fall by at most this many points (0.02 = 2 points)
//   questions_increase_max  questions per screen may rise by at most this share (0.10 = 10%)
//   determinism             unexpected drift must be 0
//
// PASS = the point estimate meets the criterion. `solid` = the whole 95% interval meets it too, so a pass that
// is not solid is within the noise of which cases were drawn. Runtime overhead is reported, not judged.
//
// The verdict is the ALL tier's (every scored part of every case). The same criteria are reported, never mixed in,
// on the INDEPENDENT tier (parts with a person's label; small) and on two seeded halves of the cases (`derive` and
// `heldout`, see splitOf) so a rule written after looking at one half can be checked on the other.
import { mulberry32, round, seedFrom } from "./util.mjs";
import { sumCounts, ratios } from "./metrics.mjs";

const stat = (recs) => ratios(sumCounts(recs.map((r) => r.counts)));

/** Which half of the corpus a case belongs to: a fixed hash of its id, so the split never moves. */
export const splitOf = (id) => (seedFrom("t23-split", id) & 1 ? "heldout" : "derive");

// f(baseRatios, variantRatios) -> number, on the full data and on `iters` shared resamples of the cases.
function pairedInterval(baseRecs, varRecs, f, { seed = 1, iters = 1000, confidence = 0.95 } = {}) {
  const byId = new Map(baseRecs.map((r) => [r.id, r]));
  const pairs = varRecs.filter((r) => byId.has(r.id)).map((r) => [byId.get(r.id), r]);
  const est = f(stat(pairs.map((p) => p[0])), stat(pairs.map((p) => p[1])));
  const rnd = mulberry32(seed);
  const draws = [];
  for (let i = 0; i < iters; i++) {
    const idx = Array.from({ length: pairs.length }, () => Math.floor(rnd() * pairs.length));
    const v = f(stat(idx.map((j) => pairs[j][0])), stat(idx.map((j) => pairs[j][1])));
    if (v != null && Number.isFinite(v)) draws.push(v);
  }
  draws.sort((a, b) => a - b);
  const q = (p) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(p * draws.length)))];
  const a = (1 - confidence) / 2;
  return { est, lo: draws.length ? q(a) : null, hi: draws.length ? q(1 - a) : null };
}

const pct = (x) => `${round(x * 100, 1)}%`;

// The three numeric criteria on one set of case records.
function criteriaFor(baseRecs, varRecs, spec, bootstrap) {
  const b = stat(baseRecs), v = stat(varRecs);
  const rows = [];
  const add = (name, target, iv, { fmt, direction, note = "" }) => {
    const meets = (x) => x != null && (direction === "atleast" ? x >= target : x <= target);
    rows.push({
      criterion: name, target: `${direction === "atleast" ? ">=" : "<="} ${fmt(target)}`,
      estimate: round(iv.est, 4), lo: round(iv.lo, 4), hi: round(iv.hi, 4),
      pass: meets(iv.est), solid: meets(direction === "atleast" ? iv.lo : iv.hi), note,
    });
  };
  if (spec.wrong_accept_reduction != null) {
    add("wrong-accept rate reduction (relative)", spec.wrong_accept_reduction,
      pairedInterval(baseRecs, varRecs, (x, y) => (x.wrong_accept_rate ? 1 - y.wrong_accept_rate / x.wrong_accept_rate : null), bootstrap),
      { fmt: pct, direction: "atleast", note: `${b.wrong_accepts} -> ${v.wrong_accepts} wrong accepts of ${b.data_parts} data parts` });
  }
  if (spec.recall_drop_max != null) {
    add("recall change (variant - baseline, fraction; -0.02 = 2 points)", -spec.recall_drop_max,
      pairedInterval(baseRecs, varRecs, (x, y) => y.recall - x.recall, bootstrap),
      { fmt: (x) => `${round(x, 2)}`, direction: "atleast", note: `${pct(b.recall)} -> ${pct(v.recall)}` });
  }
  if (spec.questions_increase_max != null) {
    add("questions per screen (ratio variant / baseline)", 1 + spec.questions_increase_max,
      pairedInterval(baseRecs, varRecs, (x, y) => y.questions_per_screen / x.questions_per_screen, bootstrap),
      { fmt: (x) => `x${round(x, 2)}`, direction: "atmost", note: `${round(b.questions_per_screen, 2)} -> ${round(v.questions_per_screen, 2)}` });
  }
  return rows;
}

// The records of a tier: "all" as they are, "independent" with the counts of independently labelled parts only.
const tierRecords = (recs, tier) => {
  if (tier === "independent") return recs.map((r) => ({ id: r.id, category: r.category, counts: r.counts_by_label.independent })).filter((r) => r.counts.parts + r.counts.uncertain > 0);
  if (tier === "derive" || tier === "heldout") return recs.filter((r) => splitOf(r.id) === tier);
  return recs;
};

export function evaluateAcceptance({ baseRecs, varRecs, spec, determinism, bootstrap = {} }) {
  const rows = criteriaFor(baseRecs, varRecs, spec, bootstrap);
  if (spec.determinism) {
    const n = determinism.drift.length;
    rows.push({ criterion: "determinism: unexpected drift", target: "0", estimate: n, lo: null, hi: null, pass: n === 0, solid: n === 0, note: `${determinism.cases_checked} cases` });
  }
  const tiers = {};
  for (const t of ["independent", "derive", "heldout"]) {
    const b = tierRecords(baseRecs, t), v = tierRecords(varRecs, t);
    const criteria = criteriaFor(b, v, spec, bootstrap);
    tiers[t] = { n_cases: b.length, criteria, verdict: criteria.length && criteria.every((r) => r.pass) ? "PASS" : "FAIL" };
  }
  const cats = [...new Set(varRecs.map((r) => r.category))].sort();
  const by_category = cats.map((c) => {
    const x = stat(baseRecs.filter((r) => r.category === c)), y = stat(varRecs.filter((r) => r.category === c));
    return { category: c, n: baseRecs.filter((r) => r.category === c).length, wrong_accepts: [x.wrong_accepts, y.wrong_accepts], recall: [round(x.recall, 4), round(y.recall, 4)], questions_per_screen: [round(x.questions_per_screen, 2), round(y.questions_per_screen, 2)] };
  });
  return { criteria: rows, verdict: rows.every((r) => r.pass) ? "PASS" : "FAIL", tiers, by_category, spec };
}

// Wall-clock cost of the variant's analysis over the baseline's (timing only; machine dependent).
export function runtimeOverhead(baseRecs, varRecs) {
  const byId = new Map(baseRecs.map((r) => [r.id, r]));
  const pairs = varRecs.filter((r) => byId.has(r.id)).map((r) => [byId.get(r.id), r]);
  const ms = (r) => r.timing.extract_ms + r.timing.analyze_ms;
  const total = pairs.reduce((s, [b, v]) => s + (ms(v) - ms(b)), 0);
  const parts = pairs.reduce((s, [, v]) => s + v.n_parts, 0);
  return { note: "wall-clock, machine dependent", added_ms_per_screen: round(total / pairs.length, 3), added_ms_per_1000_parts: round((total / parts) * 1000, 2), screens: pairs.length, parts };
}
