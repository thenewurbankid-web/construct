// T27.2: given a drift report (drift.mjs), decide what Trace should do about it, and store the decision.
// Deterministic: the same report and options always give the same decision; nothing here calls a model or a
// clock. No timestamp is written into the stored decision (the project rule: no timestamps in generated output);
// a caller that wants to record when a check ran passes its own `asOf` label (a build id, a git sha, a date the
// user gave), never `Date.now()`.
//
//   decideDrift(report, opts)   -> { status, affected, blocked, reason }
//   storeDrift(dir, report, decision, opts) -> the path written
import fs from "node:fs";
import path from "node:path";

// One line per affected endpoint, in the same fixed order as the report (added, then removed, then changed).
function affectedOf(report) {
  const out = [];
  for (const e of report.added) out.push({ label: `${e.method} ${e.path}`, method: e.method, path: e.path, kind: "added" });
  for (const e of report.removed) out.push({ label: `${e.method} ${e.path}`, method: e.method, path: e.path, kind: "removed" });
  for (const e of report.changed) {
    const path_ = e.path ?? e.after ?? e.before;
    out.push({ label: `${e.method} ${path_}`, method: e.method, path: path_, kind: e.kind });
  }
  return out;
}

/**
 * Decide what Trace should do about a drift report: flag the affected endpoints as stale/needs-review, and,
 * only when asked and only when drift was found, block.
 *
 * @param {{added:Array, removed:Array, changed:Array, hasDrift:boolean}} report From `diffContracts`.
 * @param {{block?: boolean, asOf?: string}} [opts] `block`: off by default, like `--confidence`-style flags
 *   elsewhere in this codebase (deterministic, opt-in, and only takes effect when drift is actually detected).
 *   `asOf`: an optional caller-supplied label (never a generated timestamp) carried into the stored decision.
 * @returns {{status:"clean"|"stale", affected:Array<{label:string,method:string,path:string,kind:string}>,
 *   blocked:boolean, reason:string|null, asOf:string|null}}
 */
export function decideDrift(report, { block = false, asOf = null } = {}) {
  const affected = affectedOf(report);
  const status = report.hasDrift ? "stale" : "clean";
  const blocked = block && report.hasDrift;
  const reason = blocked
    ? `${affected.length} endpoint${affected.length === 1 ? "" : "s"} drifted from the stored contract (${affected.map((a) => a.label).join(", ")}); run blocked (--block-on-drift).`
    : null;
  return { status, affected, blocked, reason, asOf };
}

/**
 * Store a drift report and its decision as one JSON file, so a later step (or a person) can read what was found
 * without re-fetching or re-diffing. Overwrites any previous file at that path; writes via a temp file + rename
 * so a reader never sees a half-written file.
 *
 * Creates `dir` (and any missing parent directories) first, so a caller does not need to pre-create the output
 * directory before pointing `--out` (or this function) at it.
 *
 * @param {string} dir The feature (or run) directory the file belongs to.
 * @param {{added:Array, removed:Array, changed:Array, hasDrift:boolean}} report
 * @param {{status:string, affected:Array, blocked:boolean, reason:string|null, asOf:string|null}} decision
 * @param {{file?: string}} [opts] `file`: the file name (default "drift.json").
 * @returns {string} The path written.
 */
export function storeDrift(dir, report, decision, { file = "drift.json" } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, file);
  const tmp = path.join(dir, `.${file}.${process.pid}.tmp`);
  const body = JSON.stringify({ report, decision }, null, 2) + "\n";
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, out);
  return out;
}
