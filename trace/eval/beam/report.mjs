#!/usr/bin/env node
// Markdown summary of the planner eval (#896): every setup side by side, then the items to review first.
//
//   node trace/eval/beam/report.mjs [--setup r-v1.g-v1]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, beamDirs } from "./store.mjs";

const fmt = (v) => (v === null || v === undefined ? "–" : String(v));

/**
 * @param {ReturnType<typeof createStore>} store
 * @param {{setup?: string}} [opts]
 * @returns {string}
 */
export function renderReport(store, opts = {}) {
  const setups = store.listSetups().filter((s) => !opts.setup || s.id === opts.setup);
  if (!setups.length) return "# Planner eval\n\nNo results yet. Run `node trace/eval/beam/run.mjs --dry-run` for the fixtures.\n";
  const views = setups.map((s) => store.view(s.id));
  const out = ["# Planner eval", "", "| setup | source | mode | items | grader mean | owner mean | agreement | disagree ≥2 |", "|---|---|---|---|---|---|---|---|"];
  for (const v of views) {
    const s = v.summary;
    out.push(`| ${v.setup} | ${v.source} | ${fmt(v.mode)} | ${s.items} | ${fmt(s.mean.grader)} / ${s.maxTotal} | ${fmt(s.mean.owner)} / ${s.maxTotal} | ${s.agreementRate === null ? "–" : `${Math.round(s.agreementRate * 100)}%`} (${s.graded.both} graded) | ${s.disagree2} |`);
  }
  for (const v of views) {
    out.push("", `## ${v.setup}`, "", `Rubric ${v.rubric.version}. Per line, grader / owner means:`, "");
    out.push(v.rubric.lines.map((l) => `- ${l.id} (0–${l.max}): ${fmt(v.summary.perLine[l.id].grader)} / ${fmt(v.summary.perLine[l.id].owner)}`).join("\n"));
    const review = v.items.filter((i) => i.agreement.disagree2);
    if (review.length) {
      out.push("", "Review first (grader and owner differ by 2 or more):", "");
      for (const i of review) out.push(`- **${i.id}** (Δ ${i.agreement.overall.diff > 0 ? "+" : ""}${i.agreement.overall.diff}): ${i.requirement} — grader: ${i.grader?.justification ?? "–"}${i.owner?.note ? `; owner: ${i.owner.note}` : ""}`);
    }
    const unavailable = v.items.filter((i) => !i.planner?.available);
    if (unavailable.length) out.push("", `${unavailable.length} item(s) without a planner answer: ${unavailable.map((i) => `${i.id} (${i.planner?.error})`).join("; ")}`);
  }
  return out.join("\n") + "\n";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const setup = args.includes("--setup") ? args[args.indexOf("--setup") + 1] : undefined;
  process.stdout.write(renderReport(createStore(beamDirs()), { setup }));
}
