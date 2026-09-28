#!/usr/bin/env node
// Turn a real run into a committed test case with ground truth.
//   npm run eval:promote -- <caseId> --from <dir> [--status <status.json>] [--accept-auto] [--force]
// <dir> is a feature folder with its Ledger: feature.json + page, and answers.json / decisions.json (and story.md).
// The Ledger says what was decided: a human answer in answers.json is ground truth; an answer decisions.json
// attributes to the AI is NOT (it is marked uncertain until someone confirms it); parts Trace settled by itself are
// marked uncertain unless --accept-auto says you reviewed them; parts still open in status.json stay uncertain.
// Uncertain parts are excluded from the headline numbers but kept in the file, so review means deleting the flag.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "../src/extract.mjs";
import { readContract } from "./adapter.mjs";
import { baselineAnalyze } from "./variants.mjs";
import { describeParts } from "./truth.mjs";
import { deriveTruth } from "./derive.mjs";
import { here, readJson, writeJson, hashOf } from "./util.mjs";

const maybe = (f) => { try { return readJson(f); } catch { return {}; } };

export function promote({ caseId, from, statusFile = null, acceptAuto = false, force = false, casesDir = here("cases") }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(caseId)) throw new Error("case id: lower-case letters, digits and dashes");
  const dest = path.join(casesDir, caseId);
  if (fs.existsSync(dest) && !force) throw new Error(`${dest} exists (use --force to replace it)`);
  const spec = readContract(from);
  const page = fs.readFileSync(path.join(from, spec.page ?? "page.jsx"), "utf8");
  const { matched, questions } = baselineAnalyze(extract(page), spec);
  const parts = describeParts(matched, questions);
  const truth = deriveTruth(parts, { answers: maybe(path.join(from, "answers.json")), decisions: maybe(path.join(from, "decisions.json")), unconfirmed: !acceptAuto });
  const status = statusFile ? maybe(statusFile) : {};
  for (const item of status.items ?? []) {
    const t = truth[item.id];
    if (t && !t.uncertain && item.state !== "placeholder") t.note = `still open in the run (${item.state})`;
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "feature.json"), JSON.stringify(spec, null, 2) + "\n");
  fs.writeFileSync(path.join(dest, spec.page ?? "page.jsx"), page);
  if (fs.existsSync(path.join(from, "story.md"))) fs.copyFileSync(path.join(from, "story.md"), path.join(dest, "story.md"));
  writeJson(path.join(dest, "case.json"), { id: caseId, category: "promoted", source: `promoted from ${path.basename(from)}`, sourceHash: hashOf({ spec, page }), truth });
  const unc = Object.values(truth).filter((t) => t.uncertain).length;
  return { dest, parts: parts.length, uncertain: unc };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : null);
  const caseId = a.find((x) => !x.startsWith("--") && x !== opt("--from") && x !== opt("--status"));
  if (!caseId || !opt("--from")) { console.error("usage: npm run eval:promote -- <caseId> --from <feature dir> [--status status.json] [--accept-auto] [--force]"); process.exit(1); }
  try {
    const r = promote({ caseId, from: path.resolve(opt("--from")), statusFile: opt("--status"), acceptAuto: a.includes("--accept-auto"), force: a.includes("--force") });
    console.log(`wrote ${r.dest}: ${r.parts} parts, ${r.uncertain} uncertain (review them in case.json, then run \`npm run eval:baseline\` in the same commit)`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
