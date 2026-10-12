// One eval run of a setup (#896): per item, the requester writes a requirement (+ hidden gold and notes), the planner
// answers it, the requester answers the planner's question if it asked one, and the grader scores every run blind;
// only then is the recommended run revealed and its scores become the item's grader scores.
//
//   runSetup({ apps, items, examplesDir, judges, planner, runsDir, onItem }) -> results document (store.mjs shape)
//
// Opus calls per item: 1 (write) + 1 if the planner asks (answer) + 1 per run (grade). Everything model-facing goes
// through judges.mjs; everything a judge or the planner sees comes from inputs.mjs.
import fs from "node:fs";
import path from "node:path";
import { appView, buildRequesterWriteInput, buildRequesterAnswerInput, buildPlannerRequest, buildGraderInput, blindRuns } from "./inputs.mjs";
import { normalizePlannerOutput, createAskPlanner, createFixturePlanner } from "./planner.mjs";
import { createJudges } from "./judges.mjs";
import { itemMetrics } from "./metrics.mjs";

/** Spread `count` items round-robin over the apps: [["contacts", 1], ["orders", 1], ["contacts", 2], ...]. */
export function itemSlots(apps, count) {
  const out = [];
  const per = Object.fromEntries(apps.map((a) => [a, 0]));
  for (let i = 0; i < count; i++) { const app = apps[i % apps.length]; out.push([app, ++per[app]]); }
  return out;
}

/**
 * A planner that answers from the planner.json records of earlier runs of the same setup (replay mode).
 * @param {string[]} dirs runs folders, first hit wins
 * @param {string} setup
 */
export function createRecordedPlanner(dirs, setup) {
  const map = new Map();
  for (const d of [...dirs].reverse()) {
    const root = path.join(d, setup);
    let ids = [];
    try { ids = fs.readdirSync(root); } catch { continue; }
    for (const id of ids) {
      try { const r = JSON.parse(fs.readFileSync(path.join(root, id, "planner.json"), "utf8")); map.set(r.request, r.answer); } catch { /* no record */ }
    }
  }
  return {
    kind: "recorded",
    ask(request) {
      if (typeof request !== "string") throw new TypeError("the planner takes the request text only");
      return map.has(request) ? normalizePlannerOutput(map.get(request), map.get(request).source ?? "recorded") : { available: false, source: "recorded", error: "no recorded planner answer for this request", labels: null, path: [], question: null, runs: [], recommended: null };
    },
  };
}

/**
 * @param {{
 *   apps: string[], items: number, examplesDir: string,
 *   judges: ReturnType<import("./judges.mjs").createJudges>,
 *   planner: {kind: string, ask: (request: string) => any},
 *   runsDir: string, mode: string, now?: () => string,
 *   onItem?: (item: any, index: number, total: number) => void,
 * }} o
 */
export async function runSetup(o) {
  const { apps, items: count, examplesDir, judges, planner, runsDir, mode, now = () => new Date().toISOString(), onItem } = o;
  const slots = itemSlots(apps, count);
  const views = Object.fromEntries(apps.map((a) => [a, appView(examplesDir, a)]));
  const earlier = Object.fromEntries(apps.map((a) => [a, []]));
  const items = [];
  for (const [n, [app, k]] of slots.entries()) {
    const id = `${app}-${k}`;
    const w = await judges.requesterWrite(id, buildRequesterWriteInput({ view: views[app], index: k, earlier: earlier[app] }));
    earlier[app].push(w.requirement);
    const item = { id, app, requirement: w.requirement, gold: w.gold, notes: w.notes, goldProblems: w.goldProblems, transcripts: [w.transcript] };

    // The beam streams events.jsonl next to the item's transcripts (Mission Control's Beam eval panel tails it live).
    const itemDir = path.join(runsDir, judges.setup, id);
    const eventsFile = path.join(itemDir, "events.jsonl");
    if (mode !== "replay") { fs.mkdirSync(itemDir, { recursive: true }); fs.rmSync(eventsFile, { force: true }); }
    const t0 = Date.now();
    // The app is passed as which Trace example the request is about (#904), never inside the request text.
    const example = path.join(examplesDir, app);
    const plan = planner.ask(buildPlannerRequest(item), mode === "replay" ? { example } : { eventsFile, example });
    const ms = Date.now() - t0;
    if (mode !== "replay") {
      fs.writeFileSync(path.join(itemDir, "planner.json"), JSON.stringify({ request: item.requirement, planner: planner.kind, answer: plan, at: now() }, null, 2) + "\n");
      if (plan.beam?.events && !fs.existsSync(eventsFile)) fs.writeFileSync(eventsFile, plan.beam.events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    }
    item.planner = { available: plan.available, source: plan.source, error: plan.error ?? null, ms: mode === "live" ? ms : null };
    item.beam = plan.beam ?? null;
    item.arms = plan.arms ?? null;
    item.metrics = itemMetrics(item);
    item.labels = plan.labels;
    item.runs = plan.runs;
    item.recommended = plan.recommended;
    item.plannerQuestion = plan.question;
    item.requesterAnswer = null;
    item.grader = null;

    if (plan.available && plan.question?.text) {
      const a = await judges.requesterAnswer(id, buildRequesterAnswerInput({ view: views[app], requirement: item.requirement, notes: item.notes, question: plan.question }));
      item.requesterAnswer = { answer: a.answer, option: a.option };
      item.transcripts.push(a.transcript);
    }

    if (plan.available && plan.runs.length) {
      // Blind: every run is graded before the recommended one is looked up.
      const runScores = {};
      for (const { blindId, run } of blindRuns(plan.runs, id)) {
        const g = await judges.gradeRun(id, buildGraderInput(item, run, blindId), item);
        runScores[run.id] = { blindId, scores: g.scores, justification: g.justification, problems: g.problems };
        item.transcripts.push(g.transcript);
      }
      const rec = runScores[plan.recommended];
      item.grader = { runScores, scores: rec.scores, justification: rec.justification, problems: rec.problems, setup: judges.setup, rubricVersion: judges.versions.rubric, revealedAfterGrading: true };
    }
    items.push(item);
    onItem?.(item, n, slots.length);
  }
  return { setup: judges.setup, versions: judges.versions, mode, createdAt: now(), apps, planner: planner.kind, items };
}

/**
 * Run a setup and save its results: the one entry point of the CLI (run.mjs) and the UI's re-run button.
 *   dryRun  replay recorded transcripts (results-side runs/ first, then fixtures/runs/) and recorded planner answers;
 *           never calls a model
 *   llm     a fake llm(system, prompt, meta) (tests, fixtures/record.mjs); records like a live run
 *   else    live: Opus through judges.mjs, the planner through ask.mjs
 * @param {{requester: string, grader: string, rubric?: string, apps: string[], items: number, dryRun?: boolean,
 *   planner?: "ask"|"fixture"|"recorded", plannerFixture?: string, examplesDir: string,
 *   dirs: {resultsDir: string, runsDir: string, fixturesDir: string}, store: {saveDoc: Function},
 *   llm?: Function, now?: () => string, onItem?: Function}} o
 */
export async function runAndSave(o) {
  const mode = o.llm ? "fake" : o.dryRun ? "replay" : "live";
  const replayDirs = [o.dirs.runsDir, path.join(o.dirs.fixturesDir, "runs")];
  const judges = createJudges({ mode, requester: o.requester, grader: o.grader, rubric: o.rubric, runsDir: o.dirs.runsDir, replayDirs, llm: o.llm, now: o.now });
  const kind = o.planner ?? (mode === "replay" ? "recorded" : "ask");
  const planner = kind === "ask" ? createAskPlanner()
    : kind === "fixture" ? createFixturePlanner(o.plannerFixture ?? path.join(o.dirs.fixturesDir, "planner.json"))
      : createRecordedPlanner(replayDirs, judges.setup);
  const doc = await runSetup({ apps: o.apps, items: o.items, examplesDir: o.examplesDir, judges, planner, runsDir: o.dirs.runsDir, mode, now: o.now, onItem: o.onItem });
  doc.calls = judges.calls;
  o.store.saveDoc(judges.setup, doc);
  return doc;
}
