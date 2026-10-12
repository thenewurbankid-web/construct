// The beam's run tree, folded from its events.jsonl (#902). Reads the event contract of trace/src/beam/contract.mjs
// (runOpened, runClosed{reason}, runRanked, question, done); pure apart from `readEvents`. Bad lines are kept as
// `problems`, never thrown, so a half-written file still shows.
//
//   foldEvents(events) -> Tree
//   Tree = { runs: Run[] (opening order), question: BeamQuestion|null, done: DoneEvent|null, open, closed,
//            closedBy: {<reason>: n}, problems: string[], ms: number|null }
//   Run  = { id, parent, reading, forks, status: "open"|"closed"|"won", reason, detail, score, rank, why }
//
// "won" is the run the beam ended on (done.run): a plan for approval, or the recommended option of the question.
// An event may carry `at` (ms since epoch) or the done event `ms` (wall time of the beam); either gives `ms`.
import fs from "node:fs";
import { assertBeamEvent } from "../../src/beam/contract.mjs";

/**
 * Parse events.jsonl text into events; unparsable or off-contract lines become problems.
 * @param {string} text
 * @returns {{events: any[], problems: string[]}}
 */
export function parseEvents(text) {
  const events = [], problems = [];
  for (const [i, line] of String(text ?? "").split("\n").entries()) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { problems.push(`line ${i + 1}: not JSON`); continue; }
    try { assertBeamEvent(e); events.push(e); } catch (err) { problems.push(`line ${i + 1}: ${err.message}`); }
  }
  return { events, problems };
}

/** Read and parse an events.jsonl file; a missing file is an empty tree's input. */
export function readEvents(file) {
  try { return parseEvents(fs.readFileSync(file, "utf8")); } catch { return { events: [], problems: [] }; }
}

/**
 * Fold events (already parsed) into the run tree.
 * @param {any[]} events
 * @param {string[]} [problems]
 */
export function foldEvents(events, problems = []) {
  const byId = new Map();
  const runs = [];
  const probs = [...problems];
  let question = null, done = null, first = null, last = null;
  const runOf = (id) => {
    if (!byId.has(id)) { probs.push(`${id}: event before runOpened`); const r = blank(id, null, null, []); byId.set(id, r); runs.push(r); }
    return byId.get(id);
  };
  for (const e of events ?? []) {
    if (Number.isFinite(e.at)) { first ??= e.at; last = e.at; }
    if (e.t === "runOpened") {
      if (byId.has(e.run)) { probs.push(`${e.run}: opened twice`); continue; }
      const r = blank(e.run, e.parent ?? null, e.reading, e.forks ?? []);
      byId.set(e.run, r); runs.push(r);
    } else if (e.t === "runClosed") {
      const r = runOf(e.run);
      r.status = "closed"; r.reason = e.reason; r.detail = e.detail ?? "";
    } else if (e.t === "runRanked") {
      const r = runOf(e.run);
      r.score = e.score; r.rank = e.rank; r.why = e.why ?? [];
    } else if (e.t === "question") question = e.question;
    else if (e.t === "done") done = e;
  }
  const winner = done?.run ?? (done?.outcome === "question" ? question?.recommended ?? null : null);
  if (winner && byId.has(winner) && byId.get(winner).status === "open") byId.get(winner).status = "won";
  const closedBy = {};
  for (const r of runs) if (r.status === "closed") closedBy[r.reason] = (closedBy[r.reason] ?? 0) + 1;
  const ms = Number.isFinite(done?.ms) ? done.ms : first !== null && last !== null && last > first ? last - first : null;
  return {
    runs, question, done, winner,
    open: runs.filter((r) => r.status !== "closed").length,
    closed: runs.filter((r) => r.status === "closed").length,
    closedBy, problems: probs, ms,
  };
}

function blank(id, parent, reading, forks) {
  return { id, parent, reading, forks, status: "open", reason: null, detail: "", score: null, rank: null, why: [] };
}

/** Parse + fold in one go. */
export const treeOf = (text) => { const { events, problems } = parseEvents(text); return foldEvents(events, problems); };
