#!/usr/bin/env node
// Run the planner eval for one setup (#896).
//
//   node trace/eval/beam/run.mjs --apps contacts,orders --items 10 --requester v1 --grader v1 [--dry-run]
//        [--rubric v1] [--planner ask|fixture|recorded] [--examples <dir>]
//
// Without --dry-run this is a LIVE run: every requester and grader call goes to Opus through judges.mjs (model
// "opus"), and the planner is trace/tools/jev/ask.mjs. --dry-run replays recorded transcripts (results-side runs/,
// then the committed fixtures) and never calls a model. Results: trace/eval/beam/results/<setup>/items.json
// (TRACE_BEAM_RESULTS overrides), transcripts: trace/eval/beam/runs/<setup>/<item>/ (TRACE_BEAM_RUNS overrides).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAndSave } from "./pipeline.mjs";
import { beamDirs, createStore } from "./store.mjs";
import { BEAM_DIR, loadPrompt, setupId } from "./prompts.mjs";

/** @param {string[]} argv */
export function parseArgs(argv) {
  const o = { apps: ["contacts", "orders"], items: 10, requester: undefined, grader: undefined, rubric: undefined, dryRun: false, planner: undefined, examples: path.join(BEAM_DIR, "..", "..", "examples") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === "--apps") o.apps = v().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--items") o.items = Number(v());
    else if (a === "--requester") o.requester = v();
    else if (a === "--grader") o.grader = v();
    else if (a === "--rubric") o.rubric = v();
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--planner") o.planner = v();
    else if (a === "--examples") o.examples = path.resolve(v());
    else throw new Error(`unknown argument ${a}`);
  }
  if (!Number.isInteger(o.items) || o.items < 1) throw new Error("--items must be a positive integer");
  if (o.planner && !["ask", "fixture", "recorded"].includes(o.planner)) throw new Error("--planner must be ask, fixture or recorded");
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const dirs = beamDirs();
  const setup = setupId(loadPrompt("requester", o.requester).version, loadPrompt("grader", o.grader).version);
  console.log(`${o.dryRun ? "replay" : "LIVE (Opus)"} run of ${setup}: ${o.items} item(s) over ${o.apps.join(", ")}${o.dryRun ? "" : `; up to ${o.items * 3} Opus calls (write + answer + one grade per run)`}`);
  const doc = await runAndSave({ ...o, examplesDir: o.examples, dirs, store: createStore(dirs), onItem: (it, n, total) => console.log(`  ${n + 1}/${total} ${it.id}: ${it.planner.available ? `graded ${JSON.stringify(it.grader?.scores ?? null)}` : `planner unavailable (${it.planner.error})`}`) });
  console.log(`saved ${path.join(dirs.resultsDir, setup, "items.json")} (${doc.items.length} items, ${doc.calls} model call(s))`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
