// Turns per-case records into the report: one JSON (sorted keys, stable), a Markdown summary and a
// self-contained HTML page (inline SVG, no external assets). Anything that depends on the machine or a model
// lives under `timing` or `ai` and is left out of `report_hash` (the fingerprint of everything else).
import { sumCounts, ratios, percentile, scalingExponent, LABELS } from "./metrics.mjs";
import { compareVariants, bootstrapCI, METRICS } from "./stats.mjs";
import { triage } from "./triage.mjs";
import { hashOf, round, sortKeys } from "./util.mjs";
import { drifted, keyOrderSensitive } from "./determinism.mjs";

export const HEADLINE_METRICS = ["precision", "recall", "f1", "wrong_accept_rate", "coincidence_catch_rate", "questions_per_screen", "unnecessary_question_rate", "oracle_accuracy", "coupled_excess", "library_miss_rate"];
const EXCLUDED_FROM_HASH = ["timing", "ai", "report_hash", "generated_by"];

const pctS = (x) => (x * 100).toFixed(0) + "%";
const roundRatios = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? round(v, 4) : v]));

const globToRe = (g) => new RegExp("^" + g.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
export function isKnownDrift(rec, check, config) {
  return (config.knownDrift ?? []).some((k) => k.check === check && ((k.cases ?? []).some((g) => globToRe(g).test(rec.id)) || (k.categories ?? []).includes(rec.category)));
}

export function summarizeDeterminism(records, config) {
  const checked = records.filter((r) => r.determinism);
  const drift = [], known = [], keyOrder = [];
  const keyFiles = {};
  for (const r of checked) {
    const d = r.determinism;
    for (const check of ["repeat", "apisOrder"]) {
      if (d[check].same) continue;
      (isKnownDrift(r, check, config) ? known : drift).push({ case: r.id, check, files: d[check].filesChanged ?? [], questions_changed: !d[check].questionsSame, predictions_changed: !d[check].predictionsSame });
    }
    if (keyOrderSensitive(d)) {
      keyOrder.push(r.id);
      for (const f of d.keyOrder.logicFilesChanged) keyFiles[f] = (keyFiles[f] ?? 0) + 1;
    }
  }
  const unorderedQuestions = checked.filter((r) => !r.determinism.keyOrder.questionsOrderedSame).map((r) => r.id);
  return {
    cases_checked: checked.length,
    checks: ["repeat: same inputs twice", "apisOrder: endpoints listed in another order", "keyOrder: JSON keys in another order (echoed mock files excluded)"],
    drift, // unexpected: fails the gate and refuses a baseline
    known_drift: known,
    clean: drift.length === 0,
    key_order_sensitive_cases: keyOrder.sort(),
    key_order_logic_files: keyFiles,
    key_order_question_order_changes: unorderedQuestions.sort(),
    fingerprint_hash: hashOf(Object.fromEntries(checked.map((r) => [r.id, r.fingerprint]))),
  };
}

export function buildReport({ variant, records, corpus, config, scale = null, ai = null, comparison = null }) {
  const cats = [...new Set(records.map((r) => r.category))].sort();
  const counts = (rs) => sumCounts(rs.map((r) => r.counts));
  const cat = (rs) => ({ n: rs.length, counts: counts(rs), ...roundRatios(ratios(counts(rs))) });
  // One tier of ground truth: the same counts, restricted to parts whose label comes from `lab`.
  const b = config.bootstrap ?? {};
  const tier = (lab) => {
    const rs = records.map((r) => ({ id: r.id, category: r.category, counts: r.counts_by_label[lab] })).filter((r) => r.counts.parts + r.counts.uncertain > 0);
    const c = sumCounts(rs.map((r) => r.counts));
    const out = { n_cases: rs.length, counts: c, ...roundRatios(ratios(c)) };
    if (lab === "independent" && rs.length) {
      out.ci95 = Object.fromEntries(["precision", "recall", "wrong_accept_rate", "wrong_accept_rate_all_parts", "oracle_accuracy"].map((m) => {
        const x = bootstrapCI(rs, m, { seed: b.seed ?? 1, iters: b.iters ?? 1000, confidence: b.confidence ?? 0.95 });
        return [m, { lo: round(x.lo, 4), hi: round(x.hi, 4) }];
      }));
    }
    return out;
  };
  const tiers = Object.fromEntries(LABELS.map((l) => [l, tier(l)]));
  const allParts = counts(records).parts;
  const label_independence = {
    scored_parts: allParts,
    independent_parts: tiers.independent.counts.parts,
    reference_parts: tiers.reference.counts.parts,
    self_parts: tiers.self.counts.parts,
    statement: `${tiers.independent.counts.parts} of ${allParts} scored parts (${pctS(tiers.independent.counts.parts / allParts)}) have independent truth; ${tiers.reference.counts.parts} (${pctS(tiers.reference.counts.parts / allParts)}) are synthetic cases labelled from a copy of the transform library; ${tiers.self.counts.parts} (${pctS(tiers.self.counts.parts / allParts)}) are Trace's own output. The gate is a REGRESSION detector. Only the independent column speaks to accuracy, and it is small.`,
  };
  const t = triage(records);
  const timing = {
    note: "wall-clock, machine dependent: excluded from report_hash",
    case_analyze_ms: { p50: round(percentile(records.map((r) => r.timing.extract_ms + r.timing.analyze_ms), 50), 2), p95: round(percentile(records.map((r) => r.timing.extract_ms + r.timing.analyze_ms), 95), 2) },
    case_pipeline_ms: { p50: round(percentile(records.filter((r) => r.timing.pipeline_ms != null).map((r) => r.timing.pipeline_ms), 50), 2), p95: round(percentile(records.filter((r) => r.timing.pipeline_ms != null).map((r) => r.timing.pipeline_ms), 95), 2) },
    scale,
  };
  const det = summarizeDeterminism(records, config);
  const report = {
    schema: 1,
    variant: variant.name,
    variant_description: variant.describe ?? "",
    corpus,
    label_independence,
    headline: { all: cat(records), independent: tiers.independent, reference: tiers.reference, self: tiers.self },
    categories: Object.fromEntries(cats.map((c) => [c, cat(records.filter((r) => r.category === c))])),
    determinism: det,
    triage: { failure_count: t.failure_count, by_type: t.by_type, worst_cases: t.worst_cases },
    failures: t.failures.map(({ question, ...f }) => ({ ...f, question_form: question.form, question: question.text, options: question.options, expected: question.expected })),
    cases: Object.fromEntries(records.map((r) => [r.id, { category: r.category, counts: r.counts, fingerprint: r.fingerprint ?? null, orphans: r.orphans }])),
    comparison,
    timing,
    ai,
  };
  const hashable = Object.fromEntries(Object.entries(report).filter(([k]) => !EXCLUDED_FROM_HASH.includes(k)));
  report.report_hash = hashOf(hashable);
  return sortKeys(report);
}

// The report without machine- or model-dependent parts, for "identical apart from timing" comparisons.
export const stripTiming = (rep) => Object.fromEntries(Object.entries(rep).filter(([k]) => !["timing", "ai"].includes(k)));

// ---- comparison with another variant (paired bootstrap over cases)
export function makeComparison(baseRecs, varRecs, config) {
  const b = config.bootstrap ?? {};
  return compareVariants(baseRecs, varRecs, { seed: b.seed ?? 1, iters: b.iters ?? 1000, confidence: b.confidence ?? 0.95 });
}

// ---- scale
export function summarizeScale(points, config) {
  const pts = points.sort((a, b) => a.parts - b.parts);
  const ex = (k) => round(scalingExponent(pts.map((p) => ({ size: p.parts, ms: p[k] }))), 2);
  const largest = pts[pts.length - 1];
  const limit = config.scale?.bottleneck_ms ?? 10000;
  const exp = { extract: ex("extract_ms"), match_and_questions: ex("analyze_ms"), full_pipeline: ex("pipeline_ms") };
  const cross = pts.find((p) => p.pipeline_ms > 1000);
  const small = pts[0];
  const bottleneck = !!largest && largest.pipeline_ms > limit;
  const verdict = !largest ? "no scale cases run"
    : `${bottleneck ? "COMPUTE BECOMES A BOTTLENECK only at sizes no real screen has" : "compute is NOT a bottleneck at any measured size"}: a ${small.parts}-part screen runs end to end in ${Math.round(small.pipeline_ms)} ms; matching grows ~n^${exp.match_and_questions} and the whole pipeline ~n^${exp.full_pipeline} (quadratic-ish: every value is tried against every field); ${cross ? `a screen crosses 1 s at about ${cross.parts} parts` : "no size reached 1 s"}, and ${largest.parts} parts take ${(largest.pipeline_ms / 1000).toFixed(1)} s (limit ${limit / 1000} s). Real screens have 25-40 parts.`;
  return { points: pts.map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "number" ? round(v, 1) : v]))), exponent: exp, bottleneck, verdict, limit_ms: limit };
}

// ---------------------------------------------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------------------------------------------
const pct = (x, d = 1) => (x == null ? "n/a" : (x * 100).toFixed(d) + "%");
const num = (x, d = 2) => (x == null ? "n/a" : x.toFixed(d));
const FMT = { precision: pct, recall: pct, f1: pct, wrong_accept_rate: (x) => pct(x, 2), wrong_accept_rate_all_parts: (x) => pct(x, 2), coincidence_catch_rate: pct, oracle_accuracy: pct, unnecessary_question_rate: pct, library_miss_rate: pct, questions_per_screen: num, coupled_excess: (x) => String(x) };
const NAMES = { precision: "precision", recall: "recall", f1: "F1", wrong_accept_rate: "wrong-accept rate (data parts)", wrong_accept_rate_all_parts: "wrong-accept rate (all parts)", coincidence_catch_rate: "coincidence catch", questions_per_screen: "questions / screen", unnecessary_question_rate: "unnecessary questions", oracle_accuracy: "oracle accuracy", coupled_excess: "coupled-tie excess questions", library_miss_rate: "library-gap misses" };

const both = (x) => `${pct(x.wrong_accept_rate, 2)} (${x.wrong_accepts}/${x.data_parts} data parts); ${pct(x.wrong_accept_rate_all_parts, 2)} (${x.wrong_accepts}/${x.scored_parts} all parts)`;
const withCi = (x, m, ci) => (ci?.[m] ? `${FMT[m](x[m])} [${FMT[m](ci[m].lo)}, ${FMT[m](ci[m].hi)}]` : FMT[m](x[m]));

export function renderMd(rep) {
  const h = rep.headline.all, ind = rep.headline.independent, ref = rep.headline.reference, self = rep.headline.self;
  const L = [];
  L.push(`# Trace eval report: variant \`${rep.variant}\``, "", `${rep.variant_description}`, "");
  L.push(`**Label independence:** ${rep.label_independence.statement}`, "");
  L.push(`Corpus: ${rep.corpus.cases} cases (${rep.corpus.examples} shipped examples, ${rep.corpus.synthetic} synthetic), corpus hash \`${rep.corpus.hash}\`. ${h.scored_parts} scored parts; **${h.uncertain_parts} uncertain parts excluded** (${rep.corpus.uncertain_cases} cases have some). Report hash \`${rep.report_hash}\` (timing and AI excluded).`, "");
  L.push("## Headline, by where the truth comes from", "", `| metric | INDEPENDENT truth (${ind.counts.parts} parts, ${ind.n_cases} examples; 95% interval) | synthetic reference (${ref.counts.parts} parts; regression) | self-labelled (${self.counts.parts} parts; CIRCULAR: measures regression, not accuracy) | all (${h.counts.parts}; regression total, what the gate uses) |`, "|---|---|---|---|---|");
  for (const m of HEADLINE_METRICS) L.push(`| ${NAMES[m]} | ${withCi(ind, m, ind.ci95)} | ${FMT[m](ref[m])} | ${FMT[m](self[m])} | ${FMT[m](h[m])} |`);
  L.push(`| wrong-accept rate over ALL scored parts | ${withCi(ind, "wrong_accept_rate_all_parts", ind.ci95)} | ${pct(ref.wrong_accept_rate_all_parts, 2)} | ${pct(self.wrong_accept_rate_all_parts, 2)} | ${pct(h.wrong_accept_rate_all_parts, 2)} |`);
  L.push("", `Wrong-accept rate = parts wired confidently and wrongly. It is reported over both denominators: **all cases: ${both(h)}**. Independent truth: ${both(ind)}. The independent column is small; read its interval, not its point value. Self-labelled parts cannot show a wrong accept by construction (the truth is Trace's answer).`, "");
  L.push("## By category", "", "| category | n | precision | recall | wrong-accept | coincidence catch | q/screen | unnecessary | oracle |", "|---|---|---|---|---|---|---|---|---|");
  for (const [c, v] of Object.entries(rep.categories)) L.push(`| ${c} | ${v.n} | ${pct(v.precision)} | ${pct(v.recall)} | ${pct(v.wrong_accept_rate, 2)} | ${pct(v.coincidence_catch_rate)} | ${num(v.questions_per_screen)} | ${pct(v.unnecessary_question_rate)} | ${pct(v.oracle_accuracy)} |`);
  const d = rep.determinism;
  L.push("", "## Determinism", "", `${d.cases_checked} cases run twice and with endpoints and JSON keys reordered. Unexpected drift: **${d.drift.length}**. ${d.clean ? "Clean." : "DIRTY: " + d.drift.map((x) => `${x.case} (${x.check})`).join(", ")}`, "");
  if (d.known_drift.length) L.push(`Known, documented drift (allowed by eval/config.json): ${d.known_drift.map((x) => `${x.case} (${x.check})`).join(", ")}.`, "");
  L.push(`Key-order sensitivity (report only): ${d.key_order_sensitive_cases.length} cases change a generated file other than the echoed mock/test when JSON keys are reordered (${Object.entries(d.key_order_logic_files).map(([f, n]) => `${f} x${n}`).join(", ") || "none"}); question option order changes in ${d.key_order_question_order_changes.length} cases (the first option is the --yes default).`, "");
  L.push("## Failures and the question that would fix them", "");
  for (const e of rep.triage.by_type) L.push(`- **${e.type}** x${e.count}: fixed by the "${e.form}" question form (${Object.entries(e.categories).map(([c, n]) => `${c} ${n}`).join(", ")})`);
  if (rep.timing.scale) L.push("", "## Scaling", "", rep.timing.scale.verdict, "", "| case | parts | contract fields | extract ms | match+questions ms | full pipeline ms (includes those two) |", "|---|---|---|---|---|---|", ...rep.timing.scale.points.map((p) => `| ${p.case} | ${p.parts} | ${p.contract_fields} | ${p.extract_ms} | ${p.analyze_ms} | ${p.pipeline_ms} |`));
  L.push("", "## Runtime (timing, not part of the hash)", "", `Per case, extract+match+questions: p50 ${rep.timing.case_analyze_ms.p50} ms, p95 ${rep.timing.case_analyze_ms.p95} ms. Full pipeline (emit + prettier): p50 ${rep.timing.case_pipeline_ms.p50} ms, p95 ${rep.timing.case_pipeline_ms.p95} ms.`);
  if (rep.ai) {
    L.push("", "## AI", "");
    if (rep.ai.status !== "ran") L.push(`Not run: ${rep.ai.status}`);
    else L.push(`Model ${rep.ai.model}: ${rep.ai.accepted} of ${rep.ai.questions} questions answered (abstained ${pct(rep.ai.abstention_rate)}), accepted-and-correct ${pct(rep.ai.accuracy_of_accepted)}, tokens ${rep.ai.tokens}, latency ${Math.round(rep.ai.latency_ms_total)} ms total. ECE ${rep.ai.ece == null ? "n/a (this model reports no confidence)" : num(rep.ai.ece, 3)}.`);
  }
  if (rep.comparison) {
    L.push("", "## Variant vs baseline (paired bootstrap over cases; real = interval excludes 0)", "", "| category | metric | baseline | variant | diff [95% CI] | verdict |", "|---|---|---|---|---|---|");
    for (const [c, ms] of Object.entries(rep.comparison)) for (const [m, x] of Object.entries(ms)) if (x.verdict !== "identical" && x.verdict !== "no data") L.push(`| ${c} | ${NAMES[m] ?? m} | ${FMT[m](x.base)} | ${FMT[m](x.variant)} | ${num(x.diff, 3)} [${num(x.lo, 3)}, ${num(x.hi, 3)}] | ${x.verdict} |`);
  }
  return L.join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------------------------
// HTML: one small bar chart per metric, inline SVG, light and dark.
// ---------------------------------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function bars(title, rows, { fmt, max, better }) {
  const w = 460, rowH = 20, left = 150, h = rows.length * rowH + 8;
  const top = max ?? Math.max(...rows.map((r) => r.value ?? 0), 1e-9);
  const body = rows.map((r, i) => {
    const y = 4 + i * rowH, bw = r.value == null ? 0 : Math.max(1, ((w - left - 70) * r.value) / top);
    return `<g><text x="${left - 8}" y="${y + 13}" text-anchor="end" class="lbl">${esc(r.label)}</text><rect x="${left}" y="${y + 3}" width="${bw.toFixed(1)}" height="12" rx="2" class="bar${r.label === "all" ? " all" : ""}"/><text x="${left + bw + 6}" y="${y + 13}" class="val">${r.value == null ? "n/a" : fmt(r.value)}</text></g>`;
  }).join("");
  return `<figure><figcaption>${esc(title)} <span class="hint">${better === "up" ? "higher is better" : "lower is better"}</span></figcaption><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)} by category">${body}</svg></figure>`;
}

function scaleChart(sc) {
  if (!sc?.points?.length) return "";
  const W = 460, H = 220, L = 50, B = 30, T = 10, R = 10;
  const xs = sc.points.map((p) => Math.log10(p.parts));
  const series = [["extract_ms", "extract"], ["analyze_ms", "match + questions"], ["pipeline_ms", "full pipeline"]];
  const all = series.flatMap(([k]) => sc.points.map((p) => Math.max(p[k], 0.1)));
  const ymin = Math.log10(Math.min(...all)), ymax = Math.log10(Math.max(...all));
  const X = (v) => L + ((v - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs) || 1)) * (W - L - R);
  const Y = (v) => H - B - ((Math.log10(Math.max(v, 0.1)) - ymin) / (ymax - ymin || 1)) * (H - B - T);
  const lines = series.map(([k, name], i) => `<polyline fill="none" class="ln l${i}" points="${sc.points.map((p) => `${X(Math.log10(p.parts)).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(" ")}"/>` + sc.points.map((p) => `<circle cx="${X(Math.log10(p.parts)).toFixed(1)}" cy="${Y(p[k]).toFixed(1)}" r="3" class="pt l${i}"/>`).join("")).join("");
  const ticks = sc.points.map((p) => `<text x="${X(Math.log10(p.parts)).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="lbl">${p.parts}</text>`).join("");
  const leg = series.map(([, n], i) => `<tspan class="l${i}k" x="${L + 8 + i * 120}" dy="0">${n}</tspan>`).join("");
  return `<figure><figcaption>Time against parts, log-log (ms) <span class="hint">flatter is better</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="scaling curve"><line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" class="ax"/><line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" class="ax"/>${lines}${ticks}<text x="4" y="${T + 10}" class="lbl">${Math.round(10 ** ymax)} ms</text><text x="4" y="${H - B}" class="lbl">${Math.round(10 ** ymin)}</text><text y="${T + 10}" class="lbl">${leg}</text></svg></figure>`;
}

function coverageChart(ai) {
  const pts = ai?.coverage_accuracy;
  if (!pts?.length) return "";
  const W = 320, H = 180, L = 40, B = 24, T = 8, R = 8;
  const X = (v) => L + v * (W - L - R), Y = (v) => H - B - v * (H - B - T);
  return `<figure><figcaption>AI coverage vs accuracy <span class="hint">up and to the right is better</span></figcaption><svg viewBox="0 0 ${W} ${H}"><line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" class="ax"/><line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" class="ax"/><polyline fill="none" class="ln l0" points="${pts.map((p) => `${X(p.coverage).toFixed(1)},${Y(p.accuracy).toFixed(1)}`).join(" ")}"/><text x="${L}" y="${H - 6}" class="lbl">coverage 0..1</text><text x="2" y="${T + 10}" class="lbl">acc</text></svg></figure>`;
}

export function renderHtml(rep) {
  const cats = ["all", ...Object.keys(rep.categories)];
  const val = (c, m) => (c === "all" ? rep.headline.all : rep.categories[c])[m];
  const charts = HEADLINE_METRICS.filter((m) => !["f1", "library_miss_rate"].includes(m)).map((m) => {
    const rows = cats.map((c) => ({ label: c, value: val(c, m) }));
    const isPct = FMT[m] !== num && m !== "coupled_excess" && m !== "questions_per_screen";
    return bars(NAMES[m], rows, { fmt: FMT[m], max: isPct ? 1 : undefined, better: METRICS[m] ?? "up" });
  }).join("");
  const h = rep.headline.all, d = rep.determinism, ind = rep.headline.independent;
  const stat = (k, v, cls = "") => `<div class="stat ${cls}"><b>${v}</b><span>${k}</span></div>`;
  const tri = rep.triage.by_type.map((e) => `<tr><td>${esc(e.type)}</td><td>${e.count}</td><td>${esc(e.form)}</td><td>${esc(Object.entries(e.categories).map(([c, n]) => `${c} ${n}`).join(", "))}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trace eval report</title><style>
:root{--bg:#fff;--fg:#1a1d21;--mut:#5b6472;--bar:#3b6fd4;--all:#1a1d21;--line:#e3e6ea;--bad:#b3261e;--ok:#1b7f45;--l0:#3b6fd4;--l1:#c2570c;--l2:#1b7f45}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#14161a;--fg:#e8eaed;--mut:#9aa3af;--bar:#7aa2f7;--all:#e8eaed;--line:#2b3038;--bad:#f2867e;--ok:#5fd08a;--l0:#7aa2f7;--l1:#f0a060;--l2:#5fd08a}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:1000px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px}p.sub,.hint{color:var(--mut)}.hint{font-size:12px;font-weight:400;margin-left:6px}
.banner{border:1px solid var(--line);border-left:4px solid var(--bad);border-radius:6px;padding:8px 12px}.stats{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}.stat{border:1px solid var(--line);border-radius:8px;padding:10px 14px;min-width:120px}.stat b{display:block;font-size:22px}.stat span{color:var(--mut);font-size:12px}.stat.bad b{color:var(--bad)}.stat.ok b{color:var(--ok)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}figure{margin:0;border:1px solid var(--line);border-radius:8px;padding:10px}figcaption{font-weight:600;font-size:13px;margin-bottom:4px}svg{width:100%;height:auto}
.lbl{font-size:10px;fill:var(--mut)}.val{font-size:10px;fill:var(--fg)}.bar{fill:var(--bar)}.bar.all{fill:var(--all)}.ax{stroke:var(--line);stroke-width:1}.ln{stroke-width:2}.l0{stroke:var(--l0);fill:var(--l0)}.l1{stroke:var(--l1);fill:var(--l1)}.l2{stroke:var(--l2);fill:var(--l2)}polyline.ln{fill:none}.l0k{fill:var(--l0)}.l1k{fill:var(--l1)}.l2k{fill:var(--l2)}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}code{font-size:12px}
</style></head><body><main>
<h1>Trace eval: variant <code>${esc(rep.variant)}</code></h1><p class="sub">${esc(rep.variant_description)} Corpus ${rep.corpus.cases} cases, hash <code>${rep.corpus.hash}</code>; report hash <code>${rep.report_hash}</code>.</p>
<p class="banner"><b>Label independence.</b> ${esc(rep.label_independence.statement)} Everything below except the independent tiles is a regression measure.</p>
<h2>Independent truth (${ind.counts.parts} parts)</h2><div class="stats">${stat("wrong-accept (data parts)", `${pct(ind.wrong_accept_rate, 2)} (${ind.wrong_accepts}/${ind.data_parts})`, ind.wrong_accepts ? "bad" : "")}${stat("wrong-accept (all parts)", `${pct(ind.wrong_accept_rate_all_parts, 2)} (${ind.wrong_accepts}/${ind.counts.parts})`)}${stat("precision", pct(ind.precision))}${stat("recall", pct(ind.recall))}${stat("oracle accuracy", pct(ind.oracle_accuracy))}</div>
<h2>Regression total (all labels; what the gate compares)</h2><div class="stats">${stat("wrong-accept (data parts)", `${pct(h.wrong_accept_rate, 2)} (${h.wrong_accepts}/${h.data_parts})`, h.wrong_accepts ? "bad" : "ok")}${stat("wrong-accept (all parts)", `${pct(h.wrong_accept_rate_all_parts, 2)} (${h.wrong_accepts}/${h.counts.parts})`)}${stat("precision", pct(h.precision))}${stat("recall", pct(h.recall))}${stat("questions / screen", num(h.questions_per_screen))}${stat("unnecessary questions", pct(h.unnecessary_question_rate))}${stat("oracle accuracy", pct(h.oracle_accuracy))}${stat("unexpected drift", d.drift.length, d.clean ? "ok" : "bad")}${stat("uncertain parts (excluded)", h.uncertain_parts)}</div>
<h2>Metrics by category</h2><div class="grid">${charts}</div>
${rep.timing.scale ? `<h2>Scaling</h2><p>${esc(rep.timing.scale.verdict)}</p><div class="grid">${scaleChart(rep.timing.scale)}</div>` : ""}
${rep.ai?.status === "ran" ? `<h2>AI</h2><p>${esc(rep.ai.model)}: ${rep.ai.accepted}/${rep.ai.questions} answered, ${pct(rep.ai.accuracy_of_accepted)} of accepted correct.</p><div class="grid">${coverageChart(rep.ai)}</div>` : ""}
<h2>What fails, and the question that would fix it</h2><table><tr><th>failure</th><th>count</th><th>question form</th><th>where</th></tr>${tri}</table>
<h2>Determinism</h2><p>${d.cases_checked} cases: repeat runs and reordered endpoints must be identical. Unexpected drift: ${d.drift.length}. Known drift: ${d.known_drift.length}. Key-order sensitive cases: ${d.key_order_sensitive_cases.length}.</p>
<p class="sub">Timing (not hashed): per case p50 ${rep.timing.case_analyze_ms.p50} ms, p95 ${rep.timing.case_analyze_ms.p95} ms for matching; full pipeline p50 ${rep.timing.case_pipeline_ms.p50} ms.</p>
</main></body></html>`;
}
