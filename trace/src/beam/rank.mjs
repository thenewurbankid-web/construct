// The Trace-plan scorer (#901), modelled on drafter staticRank (packages/engine/line/drafter/index.mjs): that one
// ranks Line routes by status, confidence, steps and files; this one ranks beam runs by what Trace knows about a plan.
// Deterministic, no model.

/** How far each check got a run: emitted-and-compiled ranks above not-yet-emitted. */
const STATUS = { verified: 0, unverified: 1 };

/**
 * The comparable summary of one run.
 * @typedef {object} RunScore
 * @property {string} id
 * @property {'verified'|'unverified'} status  verified: the scratch emit compiled.
 * @property {number} confidence  The run's reading confidence (0..1).
 * @property {number} cost        Sum of the matcher's cost over the candidates the run picked.
 * @property {number} offFirst    Sum of the picks' indexes (0 = the candidate makePlan takes today).
 * @property {number} reuse       List columns showing an API field another column already shows.
 * @property {number} todo        Parts left with no candidate.
 * @property {number} placeholders Placeholder functions the plan needs.
 */

/**
 * Score one run: a number for the event stream (higher is better) and the plain reasons.
 * @param {RunScore} s
 * @returns {{score: number, why: string[]}}
 */
export function scoreRun(s) {
  const score = Math.round((s.confidence - 0.3 * s.reuse - 0.1 * s.cost - 0.05 * s.offFirst - 0.2 * s.todo - 0.05 * s.placeholders - (s.status === "verified" ? 0 : 0.5)) * 1000) / 1000;
  const why = [];
  if (s.status === "verified") why.push("its generated code compiles");
  why.push(s.reuse ? `${s.reuse} column${s.reuse === 1 ? " repeats" : "s repeat"} a field another column shows` : "every column shows its own field");
  if (s.offFirst === 0) why.push("it keeps the matcher's first choice at every fork");
  else why.push(`it moves off the matcher's first choice ${s.offFirst} time${s.offFirst === 1 ? "" : "s"}`);
  why.push(`its picked explanations cost ${s.cost}`);
  if (s.todo) why.push(`${s.todo} part${s.todo === 1 ? " is" : "s are"} still unexplained`);
  return { score, why };
}

/**
 * Static ranking of runs: verified first, then confidence, then fewer columns repeating a field, lower cost, fewer
 * moves off the matcher's first choice, fewer unexplained parts, fewer placeholders, then id (deterministic).
 * @param {RunScore[]} runs
 * @returns {string[]} Run ids, best first.
 */
export function rankRuns(runs) {
  return [...runs]
    .sort((a, b) => STATUS[a.status] - STATUS[b.status] || b.confidence - a.confidence || a.reuse - b.reuse || a.cost - b.cost || a.offFirst - b.offFirst || a.todo - b.todo || a.placeholders - b.placeholders || a.id.localeCompare(b.id))
    .map((r) => r.id);
}
