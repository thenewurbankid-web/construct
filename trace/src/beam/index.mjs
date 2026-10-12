// The beam planner (#901, epic #900): fit a request into the Trace map by parallel runs instead of a guess.
//
// It forks Trace's pipeline (pipeline.mjs: extract -> match -> ask -> plan -> emit) without runPipeline (which writes
// files): the stage functions are called directly, and at every point where makePlan would take the first of several
// candidates a run forks into one copy per candidate. Runs are pure in-memory plans, pruned cheapest-first, every
// closed run recorded with its reason:
//   structural gate (per fork, cloned) -> zod shape -> Line preconditions (where a Trace node maps to a Line step)
//   -> scratch emit + tsc (top few only, never committed) -> goal conditions (Line expressions).
// One run meets every goal: its plan steps. Several: ONE closed question, the runs as options, recommended first.
// The only output on disk is the events.jsonl stream, when a path is given.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { extract } from "../extract.mjs";
import { match } from "../match.mjs";
import { buildQuestions } from "../ask.mjs";
import { makePlan } from "../plan.mjs";
import { readSpec } from "../contract.mjs";
import { mergeViewModel, loadViewModel, toExtractedShape } from "../viewmodel.mjs";
import { structuralContext } from "../structural-gate.mjs";
import { BEAM_CAP, assertBeamEvent } from "./contract.mjs";
import { forkPoints, refPoints, trimTo, layerRef } from "./fork.mjs";
import { checkShape, checkStructural, checkLine, scratchEmit, runFacts, checkGoals, DEFAULT_GOALS } from "./prune.mjs";
import { scoreRun, rankRuns } from "./rank.mjs";

/** How many options the one question shows (Line hints' SHOWN_CHOICES). */
export const SHOWN_OPTIONS = 4;
/** How many runs, best first, go through the scratch emit and type check. */
export const EMIT_TOP = 3;

/** The reading a Trace page request has when the caller gives none: wire the page to its API. */
export const PAGE_READING = Object.freeze({ intent: "wire.page", object: "page", target: null, layers: ["ui", "api"], confidence: 1 });

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const isPart = (p) => /^(list|value)\./.test(p) && p !== "list.sort";
/** Columns of the list settled on an API field another settled column already shows (a plain field, no aggregate). */
const reuseOf = (m) => {
  const used = (m.list?.fields ?? []).filter((f) => f.candidates.length === 1 && f.candidates[0].field && !f.candidates[0].agg).map((f) => f.candidates[0].field);
  return used.length - new Set(used).size;
};

/**
 * Plan one Trace page by parallel runs.
 * @param {object} o
 * @param {{feature: string, page: string, route: string}} o.spec     readSpec(dir).
 * @param {string} o.pageSource
 * @param {any} [o.viewModel]       The page's saved view model (loadViewModel), merged like the pipeline does.
 * @param {import('./contract.mjs').Reading[]} [o.readings]  Candidate readings, best first (default: wire the page).
 * @param {{ambiguous?: Record<string, string[]>}} [o.normalized]  Domain-map normalize() output: several keys for a
 *   slot fork the reading.
 * @param {{id: string, expr: unknown}[]} [o.goals]  Goal conditions (Line expressions over runFacts); default DEFAULT_GOALS.
 * @param {any} [o.line]            {facts, layout, pageFile, pageSource, dryRuns}: Line checks (skipped without facts).
 * @param {Record<string, string>} [o.existing]  The feature's files already generated (relative path -> source), for stub-first refs.
 * @param {number} [o.cap]          Open runs kept (default BEAM_CAP).
 * @param {number} [o.emitTop]      Runs emitted and type-checked (default EMIT_TOP).
 * @param {(files: Record<string, string>) => {ok: boolean, errors: string[]}} [o.typecheck]
 * @param {string|((e: import('./contract.mjs').BeamEvent) => void)} [o.events]  events.jsonl path, or a callback.
 * @returns {import('./contract.mjs').BeamResult}
 */
export function planBeam({ spec, pageSource, viewModel = null, readings = [PAGE_READING], normalized = null, goals = DEFAULT_GOALS, line = null, existing = {}, cap = BEAM_CAP, emitTop = EMIT_TOP, typecheck, events }) {
  /** @type {import('./contract.mjs').BeamEvent[]} */
  const log = [];
  if (typeof events === "string") { fs.mkdirSync(path.dirname(events), { recursive: true }); fs.writeFileSync(events, ""); }
  const emit = (e) => {
    assertBeamEvent(e);
    log.push(e);
    if (typeof events === "string") fs.appendFileSync(events, JSON.stringify(e) + "\n");
    else if (typeof events === "function") events(e);
  };

  // extract -> match: the same stage functions the pipeline runs, nothing saved.
  const extracted = toExtractedShape(mergeViewModel(viewModel, extract(pageSource)));
  const matched = match(extracted, spec);
  const sctx = structuralContext(pageSource, spec);

  const points = [
    ...(readings.length > 1 ? [{ point: "reading", candidates: readings.map((r, index) => ({ pick: `reading:${index}`, label: r.intent, index, cost: Math.round((1 - r.confidence) * 100) / 100 })) }] : []),
    ...(normalized ? refPoints(normalized) : []),
    ...forkPoints(matched),
  ];

  let n = 0;
  const runs = {};
  const record = (run) => { runs[run.id] = { forks: run.forks.map(({ point, pick, label }) => ({ point, pick, label })), reading: run.reading, closed: null, score: null }; };
  const close = (run, reason, detail) => {
    runs[run.id].closed = { reason, detail };
    emit({ t: "runClosed", run: run.id, reason, detail });
  };
  const open = (parent, m, reading, forks) => {
    const run = { id: `r${n++}`, m, reading, forks };
    record(run);
    emit({ t: "runOpened", run: run.id, parent: parent?.id ?? null, reading, forks: forks.map(({ point, pick, label }) => ({ point, pick, label })) });
    return run;
  };
  const summary = (run, plan, status) => ({
    id: run.id, status, confidence: run.reading.confidence,
    cost: Math.round(run.forks.reduce((s, f) => s + f.cost, 0) * 100) / 100,
    offFirst: run.forks.reduce((s, f) => s + f.index, 0),
    reuse: reuseOf(run.m),
    todo: plan ? runFacts(plan, { forks: [], emitted: false, open: [] }).plan.todo.length : 0,
    placeholders: plan ? plan.placeholders.length : 0,
  });

  // Fork at every multi-candidate point; the structural gate re-checks each part a run trimmed to one candidate.
  let live = [open(null, matched, readings[0], [])];
  for (const p of points) {
    const next = [];
    for (const run of live) {
      close(run, "forked", `Split at ${p.point} into ${p.candidates.length} runs.`);
      const kids = p.candidates.map((c) => {
        const m = isPart(p.point) || p.point === "list.sort" || p.point === "forms" ? trimTo(run.m, p.point, c.pick) : run.m;
        const reading = p.point === "reading" ? readings[c.index] : run.reading;
        const child = open(run, m, reading, [...run.forks, { point: p.point, pick: c.pick, label: c.label, index: c.index, cost: c.cost }]);
        return { child, fail: isPart(p.point) ? checkStructural(child.m, sctx, [p.point]) : null };
      });
      // The gate closes a pick only when a sibling passes: when it flags every candidate, none is a fault of its run
      // (the part is a question for the person, as in the pipeline) and all of them carry on.
      const anyPass = kids.some((k) => !k.fail);
      for (const { child, fail } of kids) {
        if (fail && anyPass) close(child, fail.reason, fail.detail);
        else next.push(child);
      }
    }
    // Beam cap: keep the best `cap` (partial scores: nothing emitted yet).
    const order = rankRuns(next.map((r) => summary(r, null, "unverified")));
    const keep = new Set(order.slice(0, cap));
    for (const r of next) if (!keep.has(r.id)) close(r, "cap", `Ranked below the ${cap} open runs at ${p.point}.`);
    live = order.slice(0, cap).map((id) => next.find((r) => r.id === id));
  }

  // plan (pure) -> shape -> Line preconditions -> duplicates.
  const planned = [];
  const seen = new Map();
  for (const run of live) {
    let plan;
    try { plan = makePlan(spec, run.m); } catch (e) { close(run, "shape", `The plan could not be made: ${String(e?.message ?? e).split("\n")[0]}`); continue; }
    const fail = checkShape(plan) ?? checkLine(plan, line);
    if (fail) { close(run, fail.reason, fail.detail); continue; }
    const sig = JSON.stringify([run.reading.intent, run.forks.filter((f) => f.point.startsWith("ref:")).map((f) => f.pick), runFacts(plan, { forks: [], emitted: false, open: [] }).plan]);
    if (seen.has(sig)) { close(run, "duplicate", `Makes the same plan as ${seen.get(sig)}.`); continue; }
    seen.set(sig, run.id);
    planned.push({ run, plan });
  }

  // Scratch emit + type check for the top few, best first; the rest are not checked that deep.
  const byId = new Map(planned.map((x) => [x.run.id, x]));
  const verified = [];
  for (const id of rankRuns(planned.map((x) => summary(x.run, x.plan, "unverified")))) {
    const x = byId.get(id);
    if (verified.length >= emitTop) { close(x.run, "cap", `Only the best ${emitTop} runs are emitted and type-checked.`); continue; }
    const { fail, files } = scratchEmit(x.plan, pageSource, spec, typecheck ? { typecheck } : {});
    if (fail) { close(x.run, fail.reason, fail.detail); continue; }
    verified.push({ ...x, files });
  }

  // Goal conditions as Line expressions.
  const survivors = [];
  for (const x of verified) {
    const openQs = buildQuestions(structuredClone(x.run.m)).map((q) => q.id);
    const fail = checkGoals(runFacts(x.plan, { forks: x.run.forks, emitted: true, open: openQs }), goals);
    if (fail) close(x.run, fail.reason, fail.detail);
    else survivors.push({ ...x, open: openQs });
  }

  const scored = new Map(survivors.map((x) => [x.run.id, scoreRun(summary(x.run, x.plan, "verified"))]));
  const ranked = rankRuns(survivors.map((x) => summary(x.run, x.plan, "verified"))).map((id) => survivors.find((x) => x.run.id === id));
  ranked.forEach((x, rank) => {
    const s = scored.get(x.run.id);
    runs[x.run.id].score = s.score;
    runs[x.run.id].steps = stepsOf(x, spec, existing);
    emit({ t: "runRanked", run: x.run.id, score: s.score, rank, why: s.why });
  });

  const closedCount = () => Object.values(runs).filter((r) => r.closed).length;
  if (ranked.length === 0) {
    emit({ t: "done", outcome: "none", run: null, open: 0, closed: closedCount() });
    return { outcome: "none", plan: null, question: null, runs, events: log };
  }
  if (ranked.length === 1) {
    const win = ranked[0].run.id;
    emit({ t: "done", outcome: "plan", run: win, open: 1, closed: closedCount() });
    return { outcome: "plan", plan: { run: win, steps: runs[win].steps }, question: null, runs, events: log };
  }
  const shown = ranked.slice(0, SHOWN_OPTIONS);
  for (const x of ranked.slice(SHOWN_OPTIONS)) close(x.run, "cap", `Only the best ${SHOWN_OPTIONS} runs are offered.`);
  const question = questionOf(spec, shown, scored);
  emit({ t: "question", question });
  emit({ t: "done", outcome: "question", run: null, open: shown.length, closed: closedCount() });
  return { outcome: "question", plan: null, question, runs, events: log };
}

/**
 * The run's plan steps: one trace.emit step per generated file, with each placeholder's stub-first ref.
 * @returns {import('./contract.mjs').BeamStep[]}
 */
function stepsOf(x, spec, existing) {
  const forks = Object.fromEntries(x.run.forks.map((f) => [f.point, f.pick]));
  const why = Object.fromEntries(x.plan.layers.map((l) => [l.name, l.why]));
  return Object.entries(x.files).map(([file, f], i) => {
    const refs = Object.fromEntries(x.plan.placeholders.filter((p) => p.layer === f.layer).map((p) => [p.fn, layerRef(p.fn, existing).ref]));
    return {
      id: `trace-${i + 1}-${slug(path.basename(file))}`,
      tool: "trace.emit",
      args: { feature: spec.feature, file, layer: f.layer, forks, ...(Object.keys(refs).length ? { refs } : {}) },
      sentence: `Write ${file} (${f.layer}${why[f.layer] ? `: ${why[f.layer]}` : ""}).`,
    };
  });
}

/** The one closed question: options are the surviving runs, recommended (best ranked) first. */
function questionOf(spec, shown, scored) {
  const differs = (point) => new Set(shown.map((x) => x.run.forks.find((f) => f.point === point)?.pick)).size > 1;
  const points = [...new Set(shown.flatMap((x) => x.run.forks.map((f) => f.point)))].filter(differs);
  const id = `beam:${crypto.createHash("sha256").update(JSON.stringify([spec.feature, points, shown.map((x) => x.run.forks.map((f) => f.pick))])).digest("hex").slice(0, 12)}`;
  const best = shown[0];
  const options = shown.map((x) => ({
    id: x.run.id,
    sentence: points.map((p) => `${p}: ${x.run.forks.find((f) => f.point === p)?.label ?? "as matched"}`).join("; "),
    effect: `Generates ${Object.keys(x.files).length} files for ${spec.feature}${x.open.length ? `; ${x.open.length} part${x.open.length === 1 ? " stays" : "s stay"} open to answer` : ""}.`,
  }));
  return {
    id,
    sentence: `${shown.length} ways to wire the ${spec.feature} page pass every check; they differ at ${points.join(", ")}. Which one?`,
    hint: `${best.run.id} is recommended because ${scored.get(best.run.id).why.join(", ")} (rule trace-rank: compiles, then no repeated field, then cost, then the matcher's order).`,
    options,
    recommended: best.run.id,
  };
}

/**
 * Answer the beam's question by id, in the plain answer shape ({answer, option}): the chosen run's plan steps.
 * @param {import('./contract.mjs').BeamResult} result
 * @param {{answer: string, option: string}} a
 * @returns {import('./contract.mjs').BeamStep[]}
 */
export function answerBeam(result, { answer, option }) {
  if (!result.question || answer !== result.question.id) throw new Error(`beam: no open question ${answer}; the open one is ${result.question?.id ?? "none"}.`);
  if (!result.question.options.some((o) => o.id === option)) throw new Error(`beam: ${option} is not an option of ${answer}; choose one of ${result.question.options.map((o) => o.id).join(", ")}.`);
  return result.runs[option].steps;
}

/**
 * planBeam for an example folder (feature.json + the page + its contract). Read only: the view model is loaded,
 * never saved.
 * @param {string} dir
 * @param {Omit<Parameters<typeof planBeam>[0], 'spec'|'pageSource'>} [o]
 * @returns {import('./contract.mjs').BeamResult}
 */
export function planBeamDir(dir, o = {}) {
  const spec = readSpec(dir);
  const pageSource = fs.readFileSync(path.join(dir, spec.page), "utf8");
  return planBeam({ spec, pageSource, viewModel: loadViewModel(dir), ...o });
}
