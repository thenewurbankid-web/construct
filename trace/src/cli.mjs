#!/usr/bin/env node
// line-matcher: design page + mock API  ->  React code in all 8 layers. No LLM.
//
//   node src/cli.mjs <feature-dir> [--out <dir>] [--yes | --ask | --ask-all | --auto] [--watch] [--ai [--ai-task task=provider:model]] [--structural] [--story-evidence]
//   node src/cli.mjs <examples-dir> --all --auto --out demo-app/src      (every example in one go)
//   node src/cli.mjs <feature-dir> --check-drift <after-contract-file> [--block-on-drift]   (T27: on-demand drift check)
//
// <feature-dir> contains feature.json (route, page), the page file and the API contract: openapi.json / openapi.yaml
// (a Swagger/OpenAPI file). Without a contract the run still happens; it says so and leaves everything that needs the API open.
// Questions are asked in the terminal when a match is missing or ambiguous; answers are
// saved to <feature-dir>/answers.json so re-runs are fully repeatable. --yes = take defaults.
// --ask-all also asks about parts that matched, so you can override them or build a placeholder.
// --auto never asks: it uses saved answers, leaves the rest open, and lists what would close each open item.
// --watch re-runs (in auto mode) whenever feature.json, the openapi file, the page or answers.json changes.
// --check-drift <after-contract-file>: on-demand only (not automatic, not tied to --watch). Diffs the feature's
// stored contract against the given file (a local file, exactly like the stored one — no live fetch, see
// drift.mjs) and prints the drift notification per feature. --block-on-drift is opt-in (off by default, same
// shape as drift-cli.mjs): only when it is given AND drift is found does that one feature's run get skipped
// (the rest of an --all batch still runs). With --out also given, the drift report/notification are written
// into that feature's own output dir, same as drift-cli.mjs's --out.
// --structural turns on the structural-coincidence gate: a match that may be a coincidence of the mock data (a count that is the row count, a running number that is an id, an overall max) is asked about (confirm-or-pick), unless the design's own words agree with the field name (docs/T23.md). Off by default.
// --story-evidence (LIN-108) turns on the story.md name tie-break: when a tie survives matching, and the example's story.md text uniquely names one candidate's field, that candidate is used instead of asking. Off by default — measured but not yet cleared for a default flip (src/name-evidence.mjs).
// For the same process on screen, run `npm start` (src/server.mjs).
import fs from "node:fs";
import path from "node:path";
import { runPipeline } from "./pipeline.mjs";
import { watchExample } from "./watch.mjs";
import { loadContract } from "./contract.mjs";
import { diffContracts } from "./drift.mjs";
import { decideDrift, storeDrift } from "./drift-policy.mjs";
import { buildDriftNotification, writeDriftReport } from "./drift-notify.mjs";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--") && a !== opt("--out") && a !== opt("--check-drift"));
if (!dir) {
  console.error("usage: node src/cli.mjs <feature-dir> [--out <dir>] [--yes | --ask | --ask-all | --auto] [--watch] [--all] [--check-drift <after-contract-file>] [--block-on-drift]");
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
const outGiven = args.includes("--out");

// T27: on-demand, per-feature drift check (not automatic, not tied to --watch — see usage comment above).
const checkDriftFile = opt("--check-drift", null);
const blockOnDrift = args.includes("--block-on-drift");

// Diffs `d`'s stored contract (as loadContract already found it) against checkDriftFile, prints the
// notification, and (with --out) writes drift.json/drift-notification.txt into that feature's own output dir.
// Returns true when the feature's run should be skipped (blocked, opt-in via --block-on-drift).
function checkDrift(d, contract) {
  if (!contract.present) {
    console.log(`  drift check skipped for ${path.basename(d)}: no stored contract to compare against.`);
    return false;
  }
  const beforeText = fs.readFileSync(path.join(d, contract.file), "utf8");
  const afterText = fs.readFileSync(checkDriftFile, "utf8");
  const report = diffContracts(beforeText, afterText);
  const decision = decideDrift(report, { block: blockOnDrift });
  let featureName;
  try { featureName = JSON.parse(fs.readFileSync(path.join(d, "feature.json"), "utf8")).feature; } catch { featureName = path.basename(d); }
  const notification = buildDriftNotification(report, decision, { feature: featureName, contractFile: contract.file });
  if (outGiven) {
    const base = path.join(outRoot, "features", featureName); // same base runPipeline would write to
    storeDrift(base, report, decision);
    writeDriftReport(base, notification);
  }
  console.log(`Subject: ${notification.subject}`);
  console.log("");
  console.log(notification.body);
  if (decision.blocked) {
    console.error(decision.reason);
    return true;
  }
  return false;
}

const dirs = args.includes("--all")
  ? fs.readdirSync(dir).map((d) => path.join(dir, d)).filter((d) => fs.existsSync(path.join(d, "feature.json"))).sort()
  : [dir];

async function runOne(d, { quiet = false } = {}) {
  const contract = loadContract(d); // the notice comes first, before anything else about the run
  if (contract.notice) console.log(`\n! ${path.basename(d)}: ${contract.notice}`);
  if (checkDriftFile && checkDrift(d, contract)) return; // blocked: skip this feature, let a multi-feature --all run continue
  const { plan, log, base, files, dynCount, open, ai: aiStats } = await runPipeline({
    dir: d,
    outRoot,
    auto,
    ai,
    askAll: args.includes("--ask-all"),
    interactive: !auto && (args.includes("--ask") || args.includes("--ask-all") || (!yes && process.stdin.isTTY)),
    structural: args.includes("--structural"),
    storyEvidence: args.includes("--story-evidence"),
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
