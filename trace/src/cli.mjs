#!/usr/bin/env node
// line-matcher: design page + mock API  ->  React code in all 8 layers. No LLM.
//
//   node src/cli.mjs <feature-dir> [--out <dir>] [--yes | --ask | --ask-all | --auto] [--watch] [--ai [--ai-task task=provider:model]]
//   node src/cli.mjs <examples-dir> --all --auto --out demo-app/src      (every example in one go)
//
// <feature-dir> contains feature.json (route, page), the page file and the API contract: openapi.json / openapi.yaml
// (a Swagger/OpenAPI file). Without a contract the run still happens; it says so and leaves everything that needs the API open.
// Questions are asked in the terminal when a match is missing or ambiguous; answers are
// saved to <feature-dir>/answers.json so re-runs are fully repeatable. --yes = take defaults.
// --ask-all also asks about parts that matched, so you can override them or build a placeholder.
// --auto never asks: it uses saved answers, leaves the rest open, and lists what would close each open item.
// --watch re-runs (in auto mode) whenever feature.json, the openapi file, the page or answers.json changes.
// For the same process on screen, run `npm start` (src/server.mjs).
import fs from "node:fs";
import path from "node:path";
import { runPipeline } from "./pipeline.mjs";
import { watchExample } from "./watch.mjs";
import { loadContract } from "./contract.mjs";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--") && a !== opt("--out"));
if (!dir) {
  console.error("usage: node src/cli.mjs <feature-dir> [--out <dir>] [--yes | --ask | --ask-all | --auto] [--watch] [--all]");
  process.exit(1);
}
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const yes = args.includes("--yes");
// --ai turns the AI layer on; --ai-task choose=anthropic:claude-haiku-4-5-20251001 (repeatable) picks the model per task.
const aiTasks = {};
args.forEach((a, i) => {
  if (a !== "--ai-task") return;
  const [task, spec] = (args[i + 1] ?? "").split("=");
  const [provider, ...model] = (spec ?? "").split(":");
  if (task && provider && model.length) aiTasks[task] = { provider, model: model.join(":") };
  else console.error(`ignored --ai-task "${args[i + 1]}" (use task=provider:model)`);
});
const ai = args.includes("--ai") || args.includes("--explain") ? { enabled: args.includes("--ai"), explain: args.includes("--explain"), overrides: { tasks: aiTasks }, trusted: true } : null;
const auto = args.includes("--auto") || args.includes("--watch");
const outRoot = opt("--out", "out");

const dirs = args.includes("--all")
  ? fs.readdirSync(dir).map((d) => path.join(dir, d)).filter((d) => fs.existsSync(path.join(d, "feature.json"))).sort()
  : [dir];

async function runOne(d, { quiet = false } = {}) {
  const contract = loadContract(d); // the notice comes first, before anything else about the run
  if (contract.notice) console.log(`\n! ${path.basename(d)}: ${contract.notice}`);
  const { plan, log, base, files, dynCount, open, ai: aiStats } = await runPipeline({
    dir: d,
    outRoot,
    auto,
    ai,
    askAll: args.includes("--ask-all"),
    interactive: !auto && (args.includes("--ask") || args.includes("--ask-all") || (!yes && process.stdin.isTTY)),
  });
  const name = plan.names.feature;
  if (quiet || dirs.length > 1 || auto) {
    console.log(`✔ ${name.padEnd(12)} ${dynCount} dynamic parts · ${open.length} open · wrote ${Object.keys(files).length + 3} files to ${base}`);
  } else {
    console.log(`\n✔ ${name}: ${dynCount} dynamic parts, ${plan.actions.length} actions, ${plan.layers.length} layers, ${log.length} questions`);
    for (const l of plan.layers) console.log(`  ${l.name.padEnd(11)} ${l.why}`);
    console.log(`\nWrote ${Object.keys(files).length} files + REPORT.md + REPORT.html + status.json to ${base}`);
  }
  if (aiStats) console.log(`    AI: ${aiStats.answered} answered, ${aiStats.drafted} drafted, ${aiStats.skipped} skipped · ${aiStats.calls} calls (${aiStats.cached} cached), ~${aiStats.tokensIn + aiStats.tokensOut} tokens${aiStats.errors.length ? " · " + aiStats.errors[0] : ""}`);
  for (const o of open) console.log(`    • ${o.part} [${o.state}] — ${o.why}\n      → ${o.hint}`);
}

for (const d of dirs) await runOne(d);

if (args.includes("--watch")) {
  console.log(`\nwatching ${dirs.length} example${dirs.length > 1 ? "s" : ""} — edit feature.json, the openapi file, the page or answers.json and it re-runs. Ctrl+C to stop.`);
  for (const d of dirs) {
    let running = false, again = false;
    const go = async () => {
      if (running) return void (again = true);
      running = true;
      console.log(`\n↻ ${path.basename(d)} changed`);
      try { await runOne(d); } catch (e) { console.error(`  ${e.message}`); }
      running = false;
      if (again) { again = false; go(); }
    };
    watchExample(d, go);
  }
}
