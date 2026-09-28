#!/usr/bin/env node
// The eval runner.
//   npm run eval                              baseline over eval/cases, writes eval/out/report.{json,md,html}
//   npm run eval -- --variant <name>          another variant, compared with baseline (paired bootstrap)
//   npm run eval -- --scale                   also time the scale cases (eval/scale)
//   npm run eval -- --ai                      also run the AI layer on the questions (needs a reachable model)
//   npm run eval -- --write-baseline          (eval:baseline) write eval/baseline.json; refuses if determinism is dirty
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCaseDirs, loadCase } from "./adapter.mjs";
import { getVariant, variantNames } from "./variants.mjs";
import { evaluateCase } from "./evaluate.mjs";
import { buildReport, renderMd, renderHtml, makeComparison, summarizeScale } from "./report.mjs";
import { runAi } from "./ai-eval.mjs";
import { ROOT, here, readJson, writeJson, hashOf } from "./util.mjs";
import { sumCounts, ratios } from "./metrics.mjs";
import { baselineFromReport } from "./gate.mjs";

const OUT = here("out");
export const loadConfig = () => readJson(here("config.json"));

export function loadCorpus(dir = here("cases")) {
  return listCaseDirs(dir).map((d) => loadCase(d));
}

function corpusInfo(loaded) {
  const drifted = loaded.filter((l) => l.meta.expect && l.meta.expect !== hashOf({ spec: l.spec, pageSource: l.pageSource, story: l.story, truth: l.truth })).map((l) => l.id);
  const stale = loaded.filter((l) => l.meta.source && l.meta.sourceHash && fs.existsSync(path.join(ROOT, l.meta.source, "feature.json"))).filter((l) => {
    const spec = readJson(path.join(ROOT, l.meta.source, "feature.json"));
    const page = fs.readFileSync(path.join(ROOT, l.meta.source, spec.page), "utf8");
    return hashOf({ spec, page }) !== l.meta.sourceHash;
  }).map((l) => l.id);
  const cats = {};
  for (const l of loaded) cats[l.category] = (cats[l.category] ?? 0) + 1;
  return {
    hash: hashOf(loaded.map((l) => [l.id, l.inputHash])),
    cases: loaded.length,
    examples: loaded.filter((l) => l.category === "example").length,
    synthetic: loaded.filter((l) => l.category !== "example").length,
    categories: cats,
    uncertain_cases: loaded.filter((l) => Object.values(l.truth).some((t) => t.uncertain)).length,
    generator_moved_cases: drifted, // a committed case whose seed now builds something else
    examples_changed_since_snapshot: stale, // examples/ moved on; the frozen copy is what is scored
  };
}

export async function runCorpus({ variant = "baseline", determinism = true, scratch = path.join(OUT, "scratch"), loaded = null, progress = false } = {}) {
  const v = typeof variant === "string" ? getVariant(variant) : variant;
  const cases = loaded ?? loadCorpus();
  fs.rmSync(scratch, { recursive: true, force: true });
  const records = [];
  for (const l of cases) {
    if (progress) process.stderr.write(`\r${v.name}: ${records.length + 1}/${cases.length} ${l.id}          `);
    records.push(await evaluateCase(l, v, { workRoot: determinism ? scratch : null, determinism }));
  }
  if (progress) process.stderr.write("\r" + " ".repeat(70) + "\r");
  return { records, corpus: corpusInfo(cases), loaded: cases, variant: v };
}

async function runScale(variant, scratch) {
  const dir = here("scale");
  if (!fs.existsSync(dir)) return null;
  const points = [];
  for (const d of listCaseDirs(dir)) {
    const l = loadCase(d);
    const rec = await evaluateCase(l, variant, { workRoot: path.join(scratch, "scale"), determinism: false });
    const fields = Object.keys(l.spec.apis.find((a) => a.method === "GET").response[0]).length;
    points.push({ case: l.id, parts: rec.n_parts, contract_fields: fields, extract_ms: rec.timing.extract_ms, analyze_ms: rec.timing.analyze_ms, pipeline_ms: rec.timing.pipeline_ms });
  }
  return summarizeScale(points, loadConfig());
}

export async function main(argv) {
  const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  const vname = opt("--variant", "baseline");
  if (!variantNames().includes(vname)) throw new Error(`unknown variant ${vname} (known: ${variantNames().join(", ")})`);
  const config = loadConfig();
  const res = await runCorpus({ variant: vname, progress: process.stderr.isTTY });
  let comparison = null;
  if (vname !== "baseline") {
    const base = await runCorpus({ variant: "baseline", determinism: false, loaded: res.loaded });
    comparison = makeComparison(base.records, res.records, config);
  }
  const scale = argv.includes("--scale") ? await runScale(res.variant, path.join(OUT, "scratch")) : null;
  let ai = null;
  if (argv.includes("--ai")) ai = await runAi({ loaded: res.loaded, variant: res.variant, workRoot: path.join(OUT, "scratch"), limit: Number(opt("--ai-limit", Infinity)), onProgress: (n) => process.stderr.isTTY && process.stderr.write(`\rAI: ${n} questions `) });
  const report = buildReport({ variant: res.variant, records: res.records, corpus: res.corpus, config, scale, ai, comparison });
  const outDir = opt("--out", OUT);
  writeJson(path.join(outDir, "report.json"), report);
  fs.writeFileSync(path.join(outDir, "report.md"), renderMd(report));
  fs.writeFileSync(path.join(outDir, "report.html"), renderHtml(report));
  fs.rmSync(path.join(OUT, "scratch"), { recursive: true, force: true });
  const h = report.headline.all, ind = report.headline.independent;
  const p = (x, d = 1) => (x == null ? "n/a" : (x * 100).toFixed(d) + "%");
  console.log(`eval ${vname}: ${report.corpus.cases} cases, ${h.scored_parts} scored parts (${h.uncertain_parts} uncertain excluded)`);
  console.log(`  label independence: ${report.label_independence.independent_parts} independent / ${report.label_independence.reference_parts} synthetic reference / ${report.label_independence.self_parts} self-labelled parts. The gate is a regression detector.`);
  console.log(`  INDEPENDENT truth: precision ${p(ind.precision)}  recall ${p(ind.recall)}  wrong-accept ${p(ind.wrong_accept_rate, 2)} (${ind.wrong_accepts}/${ind.data_parts} data parts) ${p(ind.wrong_accept_rate_all_parts, 2)} (${ind.wrong_accepts}/${ind.counts.parts} all parts)`);
  console.log(`  ALL (regression): precision ${p(h.precision)}  recall ${p(h.recall)}  wrong-accept ${p(h.wrong_accept_rate, 2)} (${h.wrong_accepts}/${h.data_parts}) ${p(h.wrong_accept_rate_all_parts, 2)} (${h.wrong_accepts}/${h.counts.parts} all parts)  oracle ${p(h.oracle_accuracy)}  q/screen ${h.questions_per_screen.toFixed(2)}  unnecessary ${p(h.unnecessary_question_rate)}`);
  console.log(`  determinism: ${report.determinism.clean ? "clean" : "DRIFT in " + report.determinism.drift.map((d) => d.case + "/" + d.check).join(", ")}${report.determinism.known_drift.length ? ` (+${report.determinism.known_drift.length} known)` : ""}; report hash ${report.report_hash}`);
  if (scale) console.log(`  scale: ${scale.verdict}`);
  if (ai) console.log(`  ai: ${ai.status === "ran" ? `${ai.accepted}/${ai.questions} answered, ${((ai.accuracy_of_accepted ?? 0) * 100).toFixed(0)}% of accepted correct` : ai.status}`);
  console.log(`  wrote ${path.join(outDir, "report.{json,md,html}")}`);
  if (argv.includes("--write-baseline")) {
    if (vname !== "baseline") throw new Error("the baseline file records the baseline variant");
    if (!report.determinism.clean) { console.error("REFUSING to write baseline.json: the determinism check found drift (see above)."); process.exit(1); }
    writeJson(here("baseline.json"), baselineFromReport(report));
    console.log("  wrote eval/baseline.json");
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.stack ?? e.message); process.exit(1); });
}
