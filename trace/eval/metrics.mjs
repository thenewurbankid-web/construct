// Metrics: pure functions, no I/O. Every number in a report comes from here, from integer counts.
//
// Vocabulary. A "part" is one dynamic thing on a screen (a row column, a value, the row order, an action). Trace
// either ACCEPTS a wiring for it on its own (confident, no question) or ASKS. Ground truth for a part is
//   match         the data settles it: Trace should accept exactly `want`
//   needs-answer  the data cannot settle it (a tie): Trace should ask, and the right answer is `want`
//   gap           nothing in the API provides it: Trace must not wire a field to it
// Parts marked `uncertain` are excluded from every count (they are only counted, so the size of the exclusion is visible).

// Where a ground-truth label comes from:
//   independent  a person's judgment from the design, the contract's own docs, a story, or a filled labelling worksheet
//   reference    the seeded synthetic corpus: truth comes from eval/reference.mjs, a copy of the transform library
//   self         what Trace itself matched (circular: it can detect a regression, it cannot show accuracy)
export const LABELS = ["independent", "reference", "self"];
export const DATA_CLASSES = new Set(["row", "value", "sort", "endpoint"]);

const allowed = (t) => new Set([t.want, ...(t.also ?? [])]);

// Score one part against its ground truth. Returns a verdict record; countsFrom() turns verdicts into integers.
export function scorePart(p, t) {
  if (!t) return { id: p.id, cls: p.cls, status: "unlabelled" };
  const label = t.label ?? "self"; // who vouches for the truth: independent | reference | self (see docs/EVAL.md)
  if (t.uncertain) return { id: p.id, cls: p.cls, status: "uncertain", why: t.uncertain, label };
  const ok = allowed(t);
  const accepted = p.outcome === "accept" && p.accepted != null;
  const correctAccept = accepted && ok.has(p.accepted);
  const v = {
    id: p.id, cls: p.cls, status: "scored", label, kind: t.kind, want: t.want,
    outcome: p.outcome, accepted: p.accepted, default: p.default,
    accepts: accepted, correct: correctAccept, wrong: accepted && !correctAccept,
    coincidence: t.coincidence ?? null, couple: t.couple ?? null,
    library: typeof t.want === "string" && t.want.startsWith("u:"),
    nOptions: p.options.length, nCandidates: p.candidates.length,
  };
  if (p.outcome === "ask") {
    v.asked = true;
    // Necessary = the recorded answer differs from what --yes would pick (the first option).
    // (When a person never recorded which way a gap was closed, necessity is unknown and left out of both counts.)
    v.necessary = t.resolutionUnknown ? null : !ok.has(p.default);
    v.answerAvailable = p.options.some((o) => ok.has(o));
  }
  return v;
}

export function emptyCounts() {
  return {
    screens: 1, parts: 0, uncertain: 0, unlabelled: 0,
    d_parts: 0, accepts: 0, correct_accepts: 0, wrong_accepts: 0, match_parts: 0, match_hits: 0, library_misses: 0,
    gap_parts: 0, gap_wired: 0, coinc_parts: 0, coinc_caught: 0,
    a_parts: 0, a_wrong_accepts: 0,
    questions: 0, questions_necessary: 0, questions_unnecessary: 0, questions_unknown: 0,
    coupled_questions: 0, coupled_groups: 0,
    oracle_total: 0, oracle_correct: 0,
  };
}

// verdicts: scorePart results. oracle: {id -> canon} of the final wiring after every question got its true answer.
export function countsFrom(verdicts, truthParts = {}, oracle = null) {
  const c = emptyCounts();
  const groups = new Map();
  for (const v of verdicts) {
    if (v.status === "uncertain") { c.uncertain++; continue; }
    if (v.status === "unlabelled") { c.unlabelled++; continue; }
    c.parts++;
    const data = DATA_CLASSES.has(v.cls);
    if (data) {
      c.d_parts++;
      if (v.accepts) c.accepts++;
      if (v.correct) c.correct_accepts++;
      if (v.wrong) c.wrong_accepts++;
      if (v.kind === "match") { c.match_parts++; if (v.correct) c.match_hits++; if (v.library) c.library_misses++; }
      if (v.kind === "gap") { c.gap_parts++; if (v.wrong) c.gap_wired++; }
      if (v.coincidence) { c.coinc_parts++; if (!v.wrong) c.coinc_caught++; }
    } else {
      c.a_parts++;
      if (v.wrong) c.a_wrong_accepts++;
    }
    if (v.asked) {
      c.questions++;
      if (v.necessary === null) c.questions_unknown++;
      else if (v.necessary) c.questions_necessary++;
      else c.questions_unnecessary++;
    }
    if (v.couple) {
      const g = groups.get(v.couple) ?? { parts: 0, asked: 0 };
      g.parts++; if (v.asked) g.asked++;
      groups.set(v.couple, g);
    }
    if (oracle) {
      c.oracle_total++;
      const t = truthParts[v.id];
      if (t && allowed(t).has(oracle[v.id])) c.oracle_correct++;
    }
  }
  // Coupled ties: k parts tied on the same k fields need ONE decision (a plan), not k. Excess = what is asked beyond that.
  for (const g of groups.values()) if (g.asked > 0) { c.coupled_questions += g.asked; c.coupled_groups++; }
  return c;
}

export function sumCounts(list) {
  const out = Object.fromEntries(Object.keys(emptyCounts()).map((k) => [k, 0]));
  for (const c of list) for (const k of Object.keys(out)) out[k] += c[k] ?? 0;
  return out;
}

const div = (a, b) => (b > 0 ? a / b : null);
export function f1(p, r) {
  return p == null || r == null || p + r === 0 ? null : (2 * p * r) / (p + r);
}

// The headline metrics, from summed counts.
export function ratios(c) {
  const precision = div(c.correct_accepts, c.accepts);
  const recall = div(c.match_hits, c.match_parts);
  return {
    precision,
    recall,
    f1: f1(precision, recall),
    wrong_accept_rate: div(c.wrong_accepts, c.d_parts), // silently wrong parts, per data part
    wrong_accept_rate_all_parts: div(c.wrong_accepts, c.parts), // the same count over every scored part, actions included
    wrong_accepts: c.wrong_accepts,
    data_parts: c.d_parts,
    coincidence_catch_rate: div(c.coinc_caught, c.coinc_parts),
    questions_per_screen: div(c.questions, c.screens),
    unnecessary_question_rate: div(c.questions_unnecessary, c.questions - c.questions_unknown),
    oracle_accuracy: div(c.oracle_correct, c.oracle_total),
    coupled_excess: c.coupled_questions - c.coupled_groups,
    library_miss_rate: div(c.library_misses, c.match_parts),
    scored_parts: c.parts,
    uncertain_parts: c.uncertain,
  };
}

// ---------- AI runs ----------
// records: [{ accepted, correct, confidence?: number in [0,1], tokens?: number, ms?: number }]
export function aiMetrics(records) {
  const n = records.length;
  const acc = records.filter((r) => r.accepted);
  const correct = acc.filter((r) => r.correct).length;
  const withConf = acc.filter((r) => typeof r.confidence === "number");
  return {
    questions: n,
    accepted: acc.length,
    accepted_correct: correct,
    accuracy_of_accepted: div(correct, acc.length),
    abstention_rate: n ? 1 - acc.length / n : null,
    coverage_accuracy: coverageAccuracy(withConf.length === acc.length ? acc : [], n),
    ece: withConf.length === acc.length && acc.length ? ece(acc) : null,
    tokens: records.reduce((s, r) => s + (r.tokens ?? 0), 0),
    latency_ms_total: records.reduce((s, r) => s + (r.ms ?? 0), 0),
  };
}

// Accept the most confident answers first: at each threshold, what share of ALL questions is answered
// (coverage) and how many of those answers are right (accuracy). Needs a confidence per answer.
export function coverageAccuracy(acc, total) {
  if (!acc.length || !total) return [];
  const sorted = [...acc].sort((a, b) => b.confidence - a.confidence);
  const out = [];
  let right = 0;
  sorted.forEach((r, i) => {
    right += r.correct ? 1 : 0;
    const last = i === sorted.length - 1 || sorted[i + 1].confidence !== r.confidence;
    if (last) out.push({ threshold: r.confidence, coverage: (i + 1) / total, accuracy: right / (i + 1) });
  });
  return out;
}

// Expected Calibration Error: the gap between stated confidence and actual accuracy, averaged over equal-width bins.
export function ece(records, bins = 10) {
  if (!records.length) return null;
  let sum = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const inBin = records.filter((r) => (b === bins - 1 ? r.confidence >= lo && r.confidence <= hi : r.confidence >= lo && r.confidence < hi));
    if (!inBin.length) continue;
    const conf = inBin.reduce((s, r) => s + r.confidence, 0) / inBin.length;
    const accu = inBin.filter((r) => r.correct).length / inBin.length;
    sum += (inBin.length / records.length) * Math.abs(conf - accu);
  }
  return sum;
}

// ---------- timing ----------
export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// Slope of log(time) against log(size): ~1 is linear, ~2 quadratic. Used to say how compute scales.
export function scalingExponent(points) {
  const pts = points.filter((p) => p.size > 0 && p.ms > 0).map((p) => [Math.log(p.size), Math.log(p.ms)]);
  if (pts.length < 2) return null;
  const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
  const num = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const den = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  return den ? num / den : null;
}
