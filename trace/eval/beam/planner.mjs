// The planner adapter of the eval (#896): request text in, the planner's answer out, in one normalized shape.
//
//   planner.ask(request: string) -> PlannerAnswer
//   PlannerAnswer = { available, source, error?, labels, path, question, runs: Run[], recommended }
//   Run           = { id, labels, path, question }
//   PathNode      = { layer, label, decision, picks?, fork }
//     layer    page-part | dynamic | api | computed | controller | hook | provider | service | contract (open: kept as given)
//     decision stub (existing stub: complete it) | fn (existing function: map / reuse) | create | static | dynamic |
//              api | computed | null
//     picks    { static, jev } when the planner records both pickers; fork = they differ (or the planner says FORK)
//
// Two implementations: `createAskPlanner` shells out to trace/tools/jev/ask.mjs "<request>" --json (another agent's
// work; when the file is missing or fails, the answer says so with available:false instead of throwing), and
// `createFixturePlanner` answers from recorded outputs (tests, the committed fixtures, replays).
//
// The beam (several runs, one recommended) does not exist yet: a single-run answer becomes runs:[that run] with
// recommended = its id. The planner only ever gets the request string: never gold, notes or rubric.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { BEAM_DIR } from "./prompts.mjs";

export const DEFAULT_ASK = path.join(BEAM_DIR, "..", "..", "tools", "jev", "ask.mjs");

const DECISIONS = [
  [/^(existing[\s_-]*)?stub$/i, "stub"],
  [/^(existing[\s_-]*)?(fn|function|map|reuse|mapped)$/i, "fn"],
  [/^(create|new|clone)$/i, "create"],
  [/^static$/i, "static"], [/^dynamic$/i, "dynamic"], [/^api$/i, "api"], [/^computed$/i, "computed"],
];
const decisionOf = (v) => {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return DECISIONS.find(([re]) => re.test(s))?.[1] ?? s;
};

/** One path node from whatever field names the planner used. */
export function normalizeNode(n) {
  if (typeof n === "string") {
    const fork = /\bFORK\b/.test(n);
    const [layer, ...rest] = n.replace(/\bFORK\b/, "").split(":");
    return { layer: layer.trim(), label: rest.join(":").trim(), decision: null, picks: null, fork };
  }
  const picks = n.picks && (n.picks.static !== undefined || n.picks.jev !== undefined) ? { static: n.picks.static ?? null, jev: n.picks.jev ?? null } : null;
  const fork = Boolean(n.fork || n.FORK || (picks && picks.static != null && picks.jev != null && picks.static !== picks.jev));
  return {
    layer: String(n.layer ?? n.kind ?? n.step ?? "?"),
    label: String(n.label ?? n.name ?? n.ref ?? n.id ?? ""),
    decision: decisionOf(n.decision ?? n.status ?? n.action ?? n.pick),
    picks,
    fork,
  };
}

const labelsOf = (l) => (l && typeof l === "object" ? {
  intent: l.intent ?? l.id ?? null,
  object: l.object ?? (typeof (l.intent ?? l.id) === "string" ? String(l.intent ?? l.id).split(".")[1] ?? null : null),
  target: l.target && typeof l.target === "object" ? { kind: l.target.kind ?? null, name: String(l.target.name ?? l.target.slot ?? "") } : { kind: null, name: String(l.target ?? "") },
  layers: Array.isArray(l.layers) ? l.layers.map((x) => (typeof x === "string" ? x : x.layer)).filter(Boolean) : [],
  by: l.by ?? null,
} : null);

const questionOf = (q) => {
  if (!q) return null;
  if (typeof q === "string") return { text: q, options: [] };
  return { text: String(q.text ?? q.sentence ?? q.question ?? ""), options: Array.isArray(q.options) ? q.options.map((o) => (typeof o === "string" ? o : String(o.label ?? o.id ?? ""))) : [] };
};

/**
 * Normalize whatever ask.mjs (or a fixture) printed into a PlannerAnswer.
 * @param {any} raw
 * @param {string} source
 */
export function normalizePlannerOutput(raw, source) {
  if (!raw || typeof raw !== "object") return { available: false, source, error: "the planner printed no JSON object", labels: null, path: [], question: null, runs: [], recommended: null };
  const runOf = (r, i) => ({
    id: String(r.id ?? `run-${i + 1}`),
    labels: labelsOf(r.labels ?? raw.labels),
    path: (r.path ?? r.trace ?? r.nodes ?? []).map(normalizeNode),
    question: questionOf(r.question ?? null),
  });
  const runs = Array.isArray(raw.runs) && raw.runs.length ? raw.runs.map(runOf) : [runOf(raw, 0)];
  const recommended = raw.recommended != null && runs.some((r) => r.id === String(raw.recommended)) ? String(raw.recommended) : runs[0].id;
  const top = runs.find((r) => r.id === recommended);
  return { available: true, source, labels: top.labels, path: top.path, question: questionOf(raw.question) ?? top.question, runs, recommended };
}

/**
 * The ask.mjs-backed planner. Degrades: a missing file, a non-zero exit or unparsable output gives available:false
 * with the reason, so an eval run records the gap instead of crashing.
 * @param {{askPath?: string, run?: typeof spawnSync, timeoutMs?: number}} [opts]
 */
export function createAskPlanner({ askPath = DEFAULT_ASK, run = spawnSync, timeoutMs = 120_000 } = {}) {
  return {
    kind: "ask",
    ask(request) {
      if (typeof request !== "string") throw new TypeError("the planner takes the request text only");
      const fail = (error) => ({ available: false, source: "ask", error, labels: null, path: [], question: null, runs: [], recommended: null });
      if (!fs.existsSync(askPath)) return fail(`${path.relative(path.join(BEAM_DIR, "..", ".."), askPath)} is not there yet (the planner CLI is built separately); use --planner fixture`);
      const res = run(process.execPath, [askPath, request, "--json"], { encoding: "utf8", timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 });
      if (res.error) return fail(`ask.mjs did not run: ${res.error.message}`);
      if (res.status !== 0) return fail(`ask.mjs exited ${res.status}: ${String(res.stderr || res.stdout).slice(0, 300)}`);
      let raw;
      try { raw = JSON.parse(res.stdout); } catch { return fail("ask.mjs --json did not print JSON"); }
      return normalizePlannerOutput(raw, "ask");
    },
  };
}

/**
 * A planner answering from recorded outputs, keyed by the exact request text.
 * @param {Record<string, any>|string} recorded The map, or a JSON file holding it.
 */
export function createFixturePlanner(recorded) {
  const map = typeof recorded === "string" ? JSON.parse(fs.readFileSync(recorded, "utf8")) : recorded;
  return {
    kind: "fixture",
    ask(request) {
      if (typeof request !== "string") throw new TypeError("the planner takes the request text only");
      if (!(request in map)) return { available: false, source: "fixture", error: "no recorded planner answer for this request", labels: null, path: [], question: null, runs: [], recommended: null };
      return normalizePlannerOutput(map[request], "fixture");
    },
  };
}
