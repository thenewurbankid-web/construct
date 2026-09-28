#!/usr/bin/env node
// The gate: compare a fresh eval with the committed eval/baseline.json and FAIL on a regression.
//   npm run eval:gate                        baseline variant (what CI runs)
//   npm run eval:gate -- --variant <name>    a candidate variant against the recorded baseline
//   npm run eval:gate -- --report <file>     an existing report.json instead of a fresh run
// Fails on: any unexpected determinism drift; more key-order-sensitive cases than the baseline; a changed corpus
// (the baseline is then meaningless: regenerate it deliberately); wrong-accept rate up, recall down or oracle
// accuracy down beyond the tolerances in eval/config.json (headline and per category).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { here, readJson, sortKeys } from "./util.mjs";

// What is kept in baseline.json: enough to compare, small enough to review in a diff.
export function baselineFromReport(rep) {
  return sortKeys({
    schema: 1,
    variant: rep.variant,
    corpus_hash: rep.corpus.hash,
    cases: rep.corpus.cases,
    headline: rep.headline.all,
    headline_independent: rep.headline.independent,
    label_independence: rep.label_independence,
    categories: rep.categories,
    determinism: { clean: rep.determinism.clean, known_drift: rep.determinism.known_drift.map((d) => `${d.case}/${d.check}`), key_order_sensitive_cases: rep.determinism.key_order_sensitive_cases.length, fingerprint_hash: rep.determinism.fingerprint_hash },
    per_case: Object.fromEntries(Object.entries(rep.cases).map(([id, c]) => [id, c.counts])),
    triage_by_type: rep.triage.by_type.map((e) => ({ type: e.type, count: e.count })),
    report_hash: rep.report_hash,
    note: "Recorded from today's algorithm. Regenerate with `npm run eval:baseline` only in a commit that says why.",
  });
}

const CHECKS = [
  // metric, direction that is WORSE
  ["wrong_accept_rate", "up"],
  ["recall", "down"],
  ["oracle_accuracy", "down"],
];

// Returns { ok, failures: [string], notes: [string], rows: [{scope, metric, base, now, delta, tolerance, ok}] }
export function compareToBaseline(baseline, rep, config) {
  const failures = [], notes = [], rows = [];
  if (baseline.corpus_hash !== rep.corpus.hash) failures.push(`corpus changed (baseline ${baseline.corpus_hash}, now ${rep.corpus.hash}): the numbers are not comparable. If the corpus change is intended, run eval:baseline in the same commit.`);
  if (!rep.determinism.clean) failures.push(`determinism drift in ${rep.determinism.drift.map((d) => `${d.case} (${d.check})`).join(", ")}`);
  const ko = rep.determinism.key_order_sensitive_cases.length, koBase = baseline.determinism?.key_order_sensitive_cases ?? 0;
  if (ko > koBase + (config.tolerances.key_order_sensitive_cases ?? 0)) failures.push(`key-order sensitivity grew: ${ko} cases now, ${koBase} in the baseline`);
  const newKnown = rep.determinism.known_drift.map((d) => `${d.case}/${d.check}`).filter((k) => !(baseline.determinism?.known_drift ?? []).includes(k));
  if (newKnown.length) failures.push(`known-drift list grew: ${newKnown.join(", ")}`);
  const check = (scope, base, now, tol) => {
    for (const [m, worse] of CHECKS) {
      const b = base[m], n = now[m];
      if (b == null || n == null) continue;
      const delta = n - b;
      const t = tol[m] ?? 0;
      const bad = worse === "up" ? delta > t + 1e-12 : -delta > t + 1e-12;
      rows.push({ scope, metric: m, base: b, now: n, delta, tolerance: t, ok: !bad });
      if (bad) failures.push(`${scope}: ${m} went ${worse === "up" ? "up" : "down"} from ${b} to ${n} (tolerance ${t})`);
    }
  };
  check("headline", baseline.headline, rep.headline.all, config.tolerances.headline);
  if (baseline.headline_independent) check("independent-truth headline", baseline.headline_independent, rep.headline.independent, config.tolerances.category);
  for (const [c, v] of Object.entries(rep.categories)) if (baseline.categories[c]) check(`category ${c}`, baseline.categories[c], v, config.tolerances.category);
  for (const c of Object.keys(baseline.categories)) if (!rep.categories[c]) failures.push(`category ${c} is missing from this run`);
  if (rep.variant !== baseline.variant) notes.push(`comparing variant "${rep.variant}" with the recorded "${baseline.variant}" baseline`);
  return { ok: failures.length === 0, failures, notes, rows };
}

export async function gateMain(argv) {
  const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  const config = readJson(here("config.json"));
  const bfile = here("baseline.json");
  if (!fs.existsSync(bfile)) { console.error("no eval/baseline.json: run `npm run eval:baseline` first"); return 2; }
  const baseline = readJson(bfile);
  let rep;
  if (opt("--report")) rep = readJson(opt("--report"));
  else {
    const { main } = await import("./run.mjs");
    const log = console.log;
    console.log = () => {};
    try { rep = await main(["--variant", opt("--variant", "baseline"), "--out", path.join(here("out"), "gate")]); } finally { console.log = log; }
  }
  const r = compareToBaseline(baseline, rep, config);
  for (const n of r.notes) console.log(`note: ${n}`);
  for (const row of r.rows.filter((x) => x.scope === "headline")) console.log(`  ${row.ok ? "ok  " : "FAIL"} ${row.scope} ${row.metric}: ${row.base} -> ${row.now}`);
  if (r.ok) { console.log("eval gate: PASS"); return 0; }
  console.log("eval gate: FAIL");
  for (const f of r.failures) console.log(`  - ${f}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) gateMain(process.argv.slice(2)).then((c) => process.exit(c));
