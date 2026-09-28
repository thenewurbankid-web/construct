#!/usr/bin/env node
// Ledger exporter: recorded decisions -> labelled examples for a future ranker (eval/labels/*.jsonl).
//   node eval/export-labels.mjs [--from <feature dir>...] [--out eval/labels] [--include-values] [--hash-names]
// One line per answered question: which part, the options offered, which one was chosen and who or what decided
// (human | ai + model). Default input: every folder under examples/.
//
// PRIVACY. By default a line holds structure only: part and field NAMES (schema, needed to learn name similarity),
// formatter and aggregate names, counts and costs. It holds NO example values from the design or the API, no story
// text and no AI evidence sentences. The case id is a hash of the folder name. --hash-names also hashes part and
// field names; --include-values adds the design's example value and the AI's cited sentence (only for data you
// may share). Lines and keys are sorted, so the files diff cleanly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "../src/extract.mjs";
import { readContract } from "./adapter.mjs";
import { baselineAnalyze } from "./variants.mjs";
import { describeParts, canonCandidate } from "./truth.mjs";
import { ROOT, here, readJson, sha, stable } from "./util.mjs";

const maybe = (f) => { try { return readJson(f); } catch { return {}; } };

// One option in anonymised, learnable form.
function optionFeatures(o, hide) {
  const v = o.value;
  if (o.custom) return { kind: "custom-placeholder" };
  if (!v || typeof v !== "object") return { kind: "action-kind", name: v == null ? null : String(v) };
  if (v.todo) return { kind: "todo" };
  if (v.static) return { kind: "static" };
  if ("dir" in v) return { kind: "sort", field: v.field ? hide(v.field) : null, dir: v.dir };
  if (v.agg === "field") return { kind: "envelope-field", field: hide(v.field), formatter: v.formatter, cost: v.cost };
  if (v.agg) return { kind: "aggregate", agg: v.agg, field: v.field ? hide(v.field) : null, formatter: v.formatter, cost: v.cost };
  return { kind: "field", field: hide(v.field), formatter: v.formatter, cost: v.cost };
}

export function exportLabels(dir, { includeValues = false, hashNames = false } = {}) {
  const hide = hashNames ? (s) => "h_" + sha(String(s)).slice(0, 8) : (s) => s;
  const spec = readContract(dir);
  const page = fs.readFileSync(path.join(dir, spec.page ?? "page.jsx"), "utf8");
  const { matched, questions } = baselineAnalyze(extract(page), spec);
  const parts = describeParts(matched, questions);
  const answers = maybe(path.join(dir, "answers.json"));
  const decisions = maybe(path.join(dir, "decisions.json"));
  const caseHash = sha(path.basename(dir)).slice(0, 10);
  const seen = new Map();
  const lines = [];
  for (const p of parts) {
    const qs = questions.filter((q) => q.id === p.qid && !q.sub);
    const q = qs[seen.get(p.qid) ?? 0];
    seen.set(p.qid, (seen.get(p.qid) ?? 0) + 1);
    if (!q || !(p.qid in answers)) continue;
    const a = answers[p.qid];
    let idx = q.options.findIndex((o) => !o.custom && JSON.stringify(o.value) === JSON.stringify(a));
    if (idx < 0 && a?.custom) idx = q.options.findIndex((o) => o.custom);
    if (idx < 0) continue; // an answer that is not among today's options (the design or data changed since)
    const d = decisions[p.qid];
    const line = {
      case: caseHash, part: hashNames ? hide(p.qid) : p.qid, part_kind: p.cls,
      n_candidates: p.candidates.length, tied: p.candidates.length > 1,
      options: q.options.map((o) => optionFeatures(o, hide)), chosen: idx,
      chosen_is_default: idx === 0,
      decided_by: d ? "ai" : "human", model: d?.model ?? null, task: d?.task ?? null,
    };
    if (includeValues) { line.example = p.example ?? null; line.evidence = d?.evidence ?? null; }
    lines.push(line);
  }
  return lines.sort((x, y) => (x.part < y.part ? -1 : x.part > y.part ? 1 : 0));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const froms = a.flatMap((x, i) => (x === "--from" ? [a[i + 1]] : []));
  const out = a.includes("--out") ? a[a.indexOf("--out") + 1] : here("labels");
  const dirs = froms.length ? froms.map((f) => path.resolve(f)) : fs.readdirSync(path.join(ROOT, "examples"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(ROOT, "examples", e.name)).sort();
  fs.mkdirSync(out, { recursive: true });
  let total = 0;
  for (const d of dirs) {
    const lines = exportLabels(d, { includeValues: a.includes("--include-values"), hashNames: a.includes("--hash-names") });
    if (!lines.length) continue;
    fs.writeFileSync(path.join(out, `${lines[0].case}.jsonl`), lines.map((l) => stable(l, 0)).join("\n") + "\n");
    total += lines.length;
  }
  console.log(`wrote ${total} labelled decisions to ${out}`);
}
