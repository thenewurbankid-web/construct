// The Quality page (/quality): the eval harness's baseline — precision, recall, wrong-accept rate, determinism and
// runtime — read from /api/quality. Rendering is pure (payload in, HTML string out) so it is unit-tested in Node;
// mountQuality() is the only DOM part. Same convention as src/ui/about.mjs.
import { esc } from "./about.mjs";

// Same convention as eval/report.mjs's pctS: whole-percent, no decimals.
export const pctS = (x) => (x == null ? "n/a" : (x * 100).toFixed(0) + "%");
const numS = (x, d = 2) => (x == null ? "n/a" : x.toFixed(d));

const PCT_METRICS = new Set(["precision", "recall", "f1", "wrong_accept_rate", "coincidence_catch_rate", "unnecessary_question_rate", "oracle_accuracy", "library_miss_rate"]);
const LABEL = { precision: "Precision", recall: "Recall", f1: "F1", wrong_accept_rate: "Wrong-accept rate", coincidence_catch_rate: "Coincidence catch", questions_per_screen: "Questions / screen", unnecessary_question_rate: "Unnecessary questions", oracle_accuracy: "Oracle accuracy", coupled_excess: "Coupled-tie excess questions", library_miss_rate: "Library-gap misses" };
const HEADLINE_ORDER = ["precision", "recall", "wrong_accept_rate", "f1", "questions_per_screen", "oracle_accuracy"];
const fmt = (m, v) => (PCT_METRICS.has(m) ? pctS(v) : m === "questions_per_screen" ? numS(v, 1) : String(v ?? "n/a"));

export function renderHeadline(headline) {
  const rows = HEADLINE_ORDER.map((m) => `<dt>${esc(LABEL[m] ?? m)}</dt><dd>${esc(fmt(m, headline.independent[m]))} <span class="sub">(all: ${esc(fmt(m, headline.all[m]))})</span></dd>`).join("");
  return `<h2 id="h-headline">Headline (independent truth, all cases in parens)</h2><dl class="kv">${rows}</dl>`;
}

export function renderDeterminism(det) {
  const status = det.clean ? `<span class="chip k-feat">Clean</span>` : `<span class="chip k-fix">${det.drift.length} unexpected drift${det.drift.length === 1 ? "" : "s"}</span>`;
  const detail = det.clean ? "" : `<ul>${det.drift.map((d) => `<li><code>${esc(d.case)}</code> (${esc(d.check)})</li>`).join("")}</ul>`;
  return `<h2 id="h-det">Determinism</h2><p>${status} <span class="sub">${det.cases_checked} case(s) checked twice, with endpoints and JSON keys reordered.</span></p>${detail}`;
}

export function renderTiming(timing) {
  const rows = [
    ["Per-case extract + match + questions", `p50 ${numS(timing.case_analyze_ms.p50)} ms, p95 ${numS(timing.case_analyze_ms.p95)} ms`],
    ["Full pipeline (emit + prettier)", `p50 ${numS(timing.case_pipeline_ms.p50)} ms, p95 ${numS(timing.case_pipeline_ms.p95)} ms`],
  ];
  return `<h2 id="h-time">Runtime</h2><dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
}

export function renderPage(data) {
  if (!data.available) return `<p class="empty">No eval report yet. Run <code>npm run eval:baseline</code> (or <code>npm run eval</code>) first.</p>`;
  return [
    `<p class="sub">Variant <code>${esc(data.variant)}</code>, ${data.cases} cases, report hash <code class="brk">${esc(data.report_hash)}</code></p>`,
    `<section aria-labelledby="h-headline">${renderHeadline(data.headline)}</section>`,
    `<section aria-labelledby="h-det">${renderDeterminism(data.determinism)}</section>`,
    `<section aria-labelledby="h-time">${renderTiming(data.timing)}</section>`,
  ].join("");
}

// DOM part. root: the element to fill; opts.fetchJson for tests.
export function mountQuality(root, opts = {}) {
  const get = opts.fetchJson ?? (async (u) => (await fetch(u, { cache: "no-store" })).json());
  (async () => {
    try { root.innerHTML = renderPage(await get("/api/quality")); }
    catch { root.innerHTML = `<p class="empty">Could not load /api/quality. Is the server running?</p>`; }
  })();
}
