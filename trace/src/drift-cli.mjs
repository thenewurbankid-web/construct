#!/usr/bin/env node
// T27 CLI: compare the stored contract against a freshly-fetched one, decide what to do, store the decision,
// and print/write the BE/FE notification. Deterministic; no network fetch is built here (see the header comment
// in drift.mjs) — both documents are given as local files, exactly like `saveContract`/`loadContract` already
// read the stored one from disk. Blocking is opt-in: without --block-on-drift this always exits 0, the same
// "off by default" shape as this codebase's other opt-in flags (e.g. `--ai`, `--watch` on the main CLI).
//
//   node src/drift-cli.mjs <before-file> <after-file> [--out <dir>] [--block-on-drift]
//                           [--feature <name>] [--to a@x,b@y] [--cc a@x,b@y]
import fs from "node:fs";
import { diffContracts } from "./drift.mjs";
import { decideDrift, storeDrift } from "./drift-policy.mjs";
import { buildDriftNotification, writeDriftReport } from "./drift-notify.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const list = (name) => (opt(name) ? opt(name).split(",").map((s) => s.trim()).filter(Boolean) : []);
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out" && args[i - 1] !== "--feature" && args[i - 1] !== "--to" && args[i - 1] !== "--cc");
const [beforeFile, afterFile] = positional;

if (!beforeFile || !afterFile) {
  console.error("usage: node src/drift-cli.mjs <before-file> <after-file> [--out <dir>] [--block-on-drift] [--feature <name>] [--to a@x,b@y] [--cc a@x,b@y]");
  process.exit(2);
}

const beforeText = fs.readFileSync(beforeFile, "utf8");
const afterText = fs.readFileSync(afterFile, "utf8");
const report = diffContracts(beforeText, afterText);
const decision = decideDrift(report, { block: args.includes("--block-on-drift") });
const notification = buildDriftNotification(report, decision, { feature: opt("--feature"), contractFile: beforeFile, to: list("--to"), cc: list("--cc") });

const outDir = opt("--out");
if (outDir) {
  const driftPath = storeDrift(outDir, report, decision);
  const notifyPath = writeDriftReport(outDir, notification);
  console.error(`wrote ${driftPath} and ${notifyPath}`);
}

console.log(`Subject: ${notification.subject}`);
console.log("");
console.log(notification.body);

if (decision.blocked) {
  console.error(decision.reason);
  process.exit(1);
}
