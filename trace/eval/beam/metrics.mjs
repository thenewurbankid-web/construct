// Deterministic metrics of the beam eval (#902): no model, no judge. Per item from the requester's gold labels, the
// beam's run tree (beam-tree.mjs over events.jsonl) and the arms' readings (static / sklearn / spaCy / jev /
// zero-shot, each a Reading[] best first, trace/src/beam/contract.mjs); then per layer and per arm over a setup.
//
//   a reading is RIGHT when its intent is the gold intent (the closed id carries the verb and the object; targets are
//   slot ids on one side and names on the other, so they are not compared). Layer hit = every gold layer is in the
//   reading's layers.
//
//   per item
//     nlpRecall      the gold reading is among the arms' candidates (any arm, any rank)
//     beamRecall     a run was opened on the gold reading
//     runs           opened, closed, closedBy {reason: n}, open at the end
//     prune          per run: right and kept (survived or won), or wrong and closed; accuracy = correct / opened;
//                    rightKept (a right run survived), wrongClosed / wrong, wrongKept, rightClosed [{run, reason}]
//     final          the run the beam ended on is right (finalRight); outcome plan | question | none
//     questions      question events (0 or 1 today)
//     checks         tscFail (runs closed by emit: scratch emit or tsc), conditionFail (closed by goal), pass (the
//                    beam ended on a plan: the winner met every goal condition; null when it asked)
//     ms             the beam's wall time (done.ms, or the events' `at` span, or the planner's timing)
//     arms           per arm: top-1 intent, correct (top-1 right), inTopK, layersHit, rescued (top-1 wrong, beam final right)
//   per setup        means and rates over items with gold and a beam; perLayer (by gold layer); perArm (accuracy,
//                    rescued count)
import { foldEvents } from "./beam-tree.mjs";

/** Normalize the arms: {arm: Reading[]} or [{arm, readings}] -> [{arm, readings}] (order kept). */
export function armsOf(arms) {
  if (!arms) return [];
  if (Array.isArray(arms)) return arms.filter((a) => a && typeof a.arm === "string").map((a) => ({ arm: a.arm, readings: Array.isArray(a.readings) ? a.readings : [] }));
  return Object.entries(arms).map(([arm, readings]) => ({ arm, readings: Array.isArray(readings) ? readings : [] }));
}

const right = (reading, gold) => Boolean(reading && gold?.intent && reading.intent === gold.intent);
const layersHit = (reading, gold) => Boolean(reading && gold?.layers?.length && gold.layers.every((l) => (reading.layers ?? []).includes(l)));

/**
 * @param {{gold?: any, beam?: {events?: any[], tree?: any, ms?: number|null}|null, arms?: any, planner?: {ms?: number}}} item
 */
export function itemMetrics(item) {
  const gold = item.gold ?? null;
  const tree = item.beam?.tree ?? (item.beam?.events ? foldEvents(item.beam.events) : null);
  const arms = armsOf(item.arms);
  if (!gold || (!tree && !arms.length)) return null;
  const candidates = arms.flatMap((a) => a.readings);
  const out = {
    nlpRecall: arms.length ? candidates.some((r) => right(r, gold)) : null,
    beamRecall: tree ? tree.runs.some((r) => right(r.reading, gold)) : null,
    runs: null, prune: null, final: null, questions: 0, checks: null, ms: null, arms: {},
  };
  let finalRight = null;
  if (tree) {
    const correct = tree.runs.filter((r) => (right(r.reading, gold) ? r.status !== "closed" : r.status === "closed")).length;
    const wrong = tree.runs.filter((r) => !right(r.reading, gold));
    const winner = tree.runs.find((r) => r.id === tree.winner) ?? null;
    finalRight = winner ? right(winner.reading, gold) : false;
    out.runs = { opened: tree.runs.length, closed: tree.closed, open: tree.open, closedBy: tree.closedBy };
    out.prune = {
      accuracy: tree.runs.length ? round(correct / tree.runs.length) : null,
      rightKept: tree.runs.some((r) => right(r.reading, gold) && r.status !== "closed"),
      wrong: wrong.length,
      wrongClosed: wrong.filter((r) => r.status === "closed").length,
      wrongKept: wrong.filter((r) => r.status !== "closed").map((r) => r.id),
      rightClosed: tree.runs.filter((r) => right(r.reading, gold) && r.status === "closed").map((r) => ({ run: r.id, reason: r.reason, detail: r.detail })),
    };
    out.final = { run: tree.winner ?? null, outcome: tree.done?.outcome ?? null, right: finalRight };
    out.questions = tree.question ? 1 : 0;
    out.checks = { tscFail: tree.closedBy.emit ?? 0, conditionFail: tree.closedBy.goal ?? 0, pass: tree.done ? (tree.done.outcome === "plan" ? true : tree.done.outcome === "none" ? false : null) : null };
    out.ms = tree.ms ?? item.beam?.ms ?? item.planner?.ms ?? null;
  }
  for (const { arm, readings } of arms) {
    const top = readings[0] ?? null;
    const ok = right(top, gold);
    out.arms[arm] = { top: top?.intent ?? null, correct: ok, inTopK: readings.some((r) => right(r, gold)), layersHit: layersHit(top, gold), rescued: finalRight === true && !ok };
  }
  return out;
}

const round = (x) => Math.round(x * 1000) / 1000;
const rate = (xs) => { const v = xs.filter((x) => x === true || x === false); return v.length ? round(v.filter(Boolean).length / v.length) : null; };
const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
const sum = (xs) => xs.filter(Number.isFinite).reduce((a, b) => a + b, 0);

/** Aggregate item metrics: [{gold, metrics}] -> rates, totals, per arm. */
function aggregate(rows) {
  const m = rows.map((r) => r.metrics);
  const closedBy = {};
  for (const x of m) for (const [k, v] of Object.entries(x.runs?.closedBy ?? {})) closedBy[k] = (closedBy[k] ?? 0) + v;
  const armNames = [...new Set(m.flatMap((x) => Object.keys(x.arms)))];
  const perArm = Object.fromEntries(armNames.map((a) => {
    const xs = m.map((x) => x.arms[a]).filter(Boolean);
    return [a, { items: xs.length, accuracy: rate(xs.map((x) => x.correct)), topK: rate(xs.map((x) => x.inTopK)), layers: rate(xs.map((x) => x.layersHit)), rescued: xs.filter((x) => x.rescued).length }];
  }));
  return {
    items: rows.length,
    nlpRecall: rate(m.map((x) => x.nlpRecall)),
    beamRecall: rate(m.map((x) => x.beamRecall)),
    pruneAccuracy: mean(m.map((x) => x.prune?.accuracy)),
    rightKept: rate(m.map((x) => x.prune?.rightKept)),
    finalRight: rate(m.map((x) => x.final?.right)),
    runsOpened: sum(m.map((x) => x.runs?.opened)),
    runsClosed: sum(m.map((x) => x.runs?.closed)),
    closedBy,
    questions: sum(m.map((x) => x.questions)),
    tscFail: sum(m.map((x) => x.checks?.tscFail)),
    conditionFail: sum(m.map((x) => x.checks?.conditionFail)),
    checksPass: rate(m.map((x) => x.checks?.pass)),
    meanMs: mean(m.map((x) => x.ms)),
    perArm,
  };
}

/**
 * Metrics over a setup's items (each with gold, beam, arms). Items without gold or a beam/arms are skipped.
 * @param {any[]} items
 */
export function setupMetrics(items) {
  const rows = items.map((i) => ({ gold: i.gold, metrics: i.metrics ?? itemMetrics(i) })).filter((r) => r.metrics);
  if (!rows.length) return null;
  const layers = [...new Set(rows.flatMap((r) => r.gold.layers ?? []))];
  return {
    ...aggregate(rows),
    perLayer: Object.fromEntries(layers.map((l) => [l, aggregate(rows.filter((r) => r.gold.layers?.includes(l)))])),
  };
}
