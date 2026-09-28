#!/usr/bin/env node
// How do the models compare? Runs every gold question (benchmarks/gold.json) through each model on its own,
// with no cache, and reports accuracy and latency. One line per call is appended to bench-log.jsonl.
//
//   node src/ai/bench.mjs --models ollama:qwen2.5vl:latest,jev:open-jev [--repeat 3] [--examples examples]
//
// Numbers: "raw" is the model's pick before our checks; "accepted" is what our rules let through (a cited fact
// that is about the part, no "static text", and for jev its own confidence gate); "precision" is how many of the
// accepted answers were right. Latency is wall time per call, cold start reported separately.
import fs from "node:fs";
import path from "node:path";
import { extract } from "../extract.mjs";
import { match } from "../match.mjs";
import { buildQuestions } from "../ask.mjs";
import { snapshotTies } from "../infer.mjs";
import { createAi } from "./index.mjs";
import { readSpec } from "../contract.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const models = (opt("--models", "ollama:qwen2.5vl:latest,jev:open-jev")).split(",").filter(Boolean);
const repeat = Number(opt("--repeat", 1));
const examples = path.resolve(opt("--examples", "examples"));
const gold = JSON.parse(fs.readFileSync(new URL("../../benchmarks/gold.json", import.meta.url), "utf8"));
delete gold._notes;

const parseModel = (s) => { const [provider, ...m] = s.split(":"); return { provider, model: m.join(":") }; };
const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "–");
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] : 0; };

// The questions each example asks with no saved answers, built the same way a run builds them.
const setups = {};
for (const ex of Object.keys(gold)) {
  const dir = path.join(examples, ex);
  const spec = readSpec(dir);
  const source = fs.readFileSync(path.join(dir, spec.page), "utf8");
  const matched = match(extract(source), spec);
  snapshotTies(matched);
  setups[ex] = { dir, spec, source, matched, questions: buildQuestions(matched) };
}

const log = [];
const results = [];
for (const spec of models) {
  const cfg = { ...parseModel(spec) };
  const rows = [];
  let cold = null;
  for (const [ex, want] of Object.entries(gold)) {
    const s = setups[ex];
    for (const [id, prefix] of Object.entries(want)) {
      const q = s.questions.find((x) => x.id === id);
      if (!q) { rows.push({ ex, id, want: prefix, status: "no such question" }); continue; }
      for (let r = 0; r < repeat; r++) {
        const entries = [];
        const ai = createAi({ dir: s.dir, spec: s.spec, source: s.source, matched: s.matched, useCache: false, trusted: true, onLog: (e) => entries.push(e), overrides: { tasks: { choose: cfg, "pick-fields": cfg, "draft-body": cfg } } });
        const t0 = Date.now();
        const picked = await ai.answer(q);
        const wall = Date.now() - t0;
        const call = entries.find((e) => e.kind === "call");
        let raw = null;
        try { raw = q.options[JSON.parse(call.answer).choice - 1]?.label ?? null; } catch {}
        const row = {
          ex, id, want: prefix, model: spec, r,
          called: !!call, ms: call?.ms ?? 0, wall,
          raw, rawOk: raw ? raw.startsWith(prefix) : false,
          accepted: picked != null, acceptedLabel: picked?.label ?? null,
          acceptedOk: picked ? picked.label.startsWith(prefix) : false,
          err: ai.stats.errors[0] ?? null,
          verdict: call?.verdict?.text ?? entries.find((e) => e.kind === "note")?.text ?? "",
        };
        if (cold === null && call) cold = call.ms;
        rows.push(row);
        log.push(row);
      }
    }
  }
  const called = rows.filter((r) => r.called);
  const ms = called.map((r) => r.ms);
  results.push({
    model: spec, n: rows.length, called: called.length,
    rawOk: rows.filter((r) => r.rawOk).length, accepted: rows.filter((r) => r.accepted).length, acceptedOk: rows.filter((r) => r.acceptedOk).length,
    cold, median: median(ms.slice(1)), p95: p95(ms.slice(1)), mean: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0, errors: [...new Set(rows.map((r) => r.err).filter(Boolean))],
    rows,
  });
}

const chance = (() => { let s = 0, n = 0; for (const [ex, want] of Object.entries(gold)) for (const id of Object.keys(want)) { const q = setups[ex].questions.find((x) => x.id === id); if (q) { s += 1 / q.options.length; n++; } } return pct(s, n); })();
console.log(`\n${Object.values(gold).reduce((n, g) => n + Object.keys(g).length, 0)} gold questions × ${repeat} run(s); random guessing would get ~${chance} right\n`);
console.log(["model".padEnd(30), "asked", "raw ok", "accepted", "precision", "cold", "median", "p95", "mean"].join("  "));
for (const r of results) {
  console.log([r.model.padEnd(30), String(r.called).padStart(5), pct(r.rawOk, r.n).padStart(6), pct(r.accepted, r.n).padStart(8), pct(r.acceptedOk, r.accepted).padStart(9), `${r.cold ?? "–"}ms`.padStart(6), `${r.median}ms`.padStart(6), `${r.p95}ms`.padStart(5), `${r.mean}ms`.padStart(5)].join("  "));
  for (const e of r.errors) console.log(`   ! ${e}`);
}
if (args.includes("--detail")) for (const r of results) { console.log(`\n${r.model}`); for (const x of r.rows) console.log(`  ${x.rawOk ? "✓" : "✗"} ${(x.ex + " " + x.id).padEnd(34)} want ${x.want.slice(0, 26).padEnd(26)} got ${(x.raw ?? "–").slice(0, 30).padEnd(30)} ${x.accepted ? "ACCEPTED" : "skipped "} ${x.ms}ms`); }
fs.appendFileSync("bench-log.jsonl", log.map((l) => JSON.stringify({ ...l, at: new Date().toISOString() })).join("\n") + "\n");
console.log(`\nper-call log appended to bench-log.jsonl (${log.length} lines)`);
