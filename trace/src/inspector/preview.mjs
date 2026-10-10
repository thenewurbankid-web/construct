// Preview before you apply: what a change would do, computed by running the real pipeline in a scratch copy of the
// example (never inside examples/), once as it is and once with the candidate answers added, both in auto mode. Nothing
// in the example is written and the scratch copy is removed afterwards. The same inputs give the same result: the run
// has no clock and no randomness, and the generated files are compared with each other, not with anything on disk.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPipeline } from "../pipeline.mjs";
import { summarize } from "../ui/vocab.mjs";
import { readAnswers, writeAnswers } from "./state.mjs";

export const SCRATCH_ROOT = fs.existsSync("/private/tmp") ? "/private/tmp" : os.tmpdir();
const SKIP_COPY = new Set(["answers.history.jsonl", "decisions.json", "ai-cache.json"]);
const NOT_CODE = new Set(["REPORT.md", "REPORT.html", "status.json"]);

// One run in auto mode, returning what the screens are made of.
async function runOnce(dir, outRoot) {
  const ev = {};
  await runPipeline({ dir, outRoot, useSaved: true, auto: true, emit: (type, data) => { ev[type] = data; } });
  return { tree: ev.tree.tree, items: Object.fromEntries((ev.items?.items ?? []).map((i) => [i.id, i])), changes: ev.changes };
}

export async function previewChanges({ dir, changes, scratchRoot = SCRATCH_ROOT }) {
  const scratch = fs.mkdtempSync(path.join(scratchRoot, "trace-preview-"));
  const rel = path.relative(path.resolve(dir, ".."), scratch);
  if (!rel.startsWith("..")) { fs.rmSync(scratch, { recursive: true, force: true }); throw new Error("the scratch copy must not be inside the examples folder"); }
  try {
    const ex = path.join(scratch, "example"), out = path.join(scratch, "out");
    fs.mkdirSync(ex);
    for (const f of fs.readdirSync(dir)) {
      const from = path.join(dir, f);
      if (SKIP_COPY.has(f) || !fs.statSync(from).isFile()) continue;
      fs.copyFileSync(from, path.join(ex, f));
    }
    const before = await runOnce(ex, out);
    const answers = readAnswers(ex);
    for (const c of changes) answers[c.id] = c.value;
    writeAnswers(ex, answers);
    const after = await runOnce(ex, out); // same output folder: the run's own diff is against the "before" files
    const a = summarize(before.tree, { items: before.items }), b = summarize(after.tree, { items: after.items });
    const ids = new Set(changes.map((c) => c.id));
    const parts = Object.keys(b.states).filter((id) => ids.has(id) || a.states[id] !== b.states[id]).map((id) => ({ id, before: a.states[id] ?? null, after: b.states[id] ?? null, requested: ids.has(id) }));
    const files = after.changes.files.filter((f) => f.status !== "unchanged" && !NOT_CODE.has(f.path)).map((f) => ({ path: `features/${after.changes.feature}/${f.path}`, status: f.status, added: f.added, removed: f.removed, hunks: f.hunks }));
    const pick = ({ total, fit, wait, gap, tie, stub, needHuman }) => ({ total, fit, wait, gap, tie, stub, needHuman });
    return { before: pick(a), after: pick(b), parts, files, line: `${a.fit} of ${a.total} parts fit → ${b.fit} of ${b.total}` };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
