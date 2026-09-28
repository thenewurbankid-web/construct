// Seeded bootstrap and paired comparison of two variants over the same cases. The unit of resampling is the CASE
// (parts within a screen are not independent), and both variants are recomputed on the SAME resample, so a
// difference is judged against the noise of which cases happened to be drawn. Same seed, same intervals.
import { mulberry32 } from "./util.mjs";
import { sumCounts, ratios } from "./metrics.mjs";

export const METRICS = {
  // metric -> which direction is better
  precision: "up", recall: "up", f1: "up", coincidence_catch_rate: "up", oracle_accuracy: "up",
  wrong_accept_rate: "down", unnecessary_question_rate: "down", questions_per_screen: "down", coupled_excess: "down",
};

const statOf = (metric, records) => ratios(sumCounts(records.map((r) => r.counts)))[metric];
const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];

// records: [{ counts }]. Returns { estimate, lo, hi } (percentile interval).
export function bootstrapCI(records, metric, { seed = 1, iters = 1000, confidence = 0.95 } = {}) {
  const rnd = mulberry32(seed);
  const est = statOf(metric, records);
  const draws = [];
  for (let i = 0; i < iters; i++) {
    const s = Array.from({ length: records.length }, () => records[Math.floor(rnd() * records.length)]);
    const v = statOf(metric, s);
    if (v != null) draws.push(v);
  }
  draws.sort((a, b) => a - b);
  if (!draws.length) return { estimate: est, lo: null, hi: null };
  const a = (1 - confidence) / 2;
  return { estimate: est, lo: q(draws, a), hi: q(draws, 1 - a) };
}

// Paired difference (variant - baseline) of one metric over cases present in both, with the verdict.
export function pairedDiff(baseRecs, varRecs, metric, { seed = 1, iters = 1000, confidence = 0.95 } = {}) {
  const byId = new Map(baseRecs.map((r) => [r.id, r]));
  const pairs = varRecs.filter((r) => byId.has(r.id)).map((r) => [byId.get(r.id), r]);
  if (!pairs.length) return { n: 0, base: null, variant: null, diff: null, lo: null, hi: null, verdict: "no data" };
  const rnd = mulberry32(seed);
  const b = statOf(metric, pairs.map((p) => p[0]));
  const v = statOf(metric, pairs.map((p) => p[1]));
  const draws = [];
  for (let i = 0; i < iters; i++) {
    const idx = Array.from({ length: pairs.length }, () => Math.floor(rnd() * pairs.length));
    const x = statOf(metric, idx.map((j) => pairs[j][0]));
    const y = statOf(metric, idx.map((j) => pairs[j][1]));
    if (x != null && y != null) draws.push(y - x);
  }
  draws.sort((a, c) => a - c);
  const a = (1 - confidence) / 2;
  const lo = draws.length ? q(draws, a) : null, hi = draws.length ? q(draws, 1 - a) : null;
  const diff = b == null || v == null ? null : v - b;
  return { n: pairs.length, base: b, variant: v, diff, lo, hi, verdict: judge(metric, diff, lo, hi) };
}

// "real" only if the interval excludes zero; otherwise the difference is noise at this corpus size.
export function judge(metric, diff, lo, hi) {
  if (diff == null || lo == null) return "no data";
  if (diff === 0 && lo === 0 && hi === 0) return "identical";
  if (lo <= 0 && hi >= 0) return "noise";
  const better = METRICS[metric] === "up" ? diff > 0 : diff < 0;
  return better ? "real improvement" : "real regression";
}

// Every metric x every category (plus "all").
export function compareVariants(baseRecs, varRecs, opts = {}) {
  const cats = ["all", ...[...new Set(varRecs.map((r) => r.category))].sort()];
  const out = {};
  for (const c of cats) {
    const f = (rs) => (c === "all" ? rs : rs.filter((r) => r.category === c));
    out[c] = {};
    for (const m of Object.keys(METRICS)) out[c][m] = pairedDiff(f(baseRecs), f(varRecs), m, opts);
  }
  return out;
}
