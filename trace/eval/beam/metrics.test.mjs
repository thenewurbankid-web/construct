// #902: the beam's run tree from events.jsonl and the deterministic metrics, over the committed fixtures. No model.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEvents, foldEvents, treeOf, readEvents } from "./beam-tree.mjs";
import { itemMetrics, setupMetrics, armsOf } from "./metrics.mjs";
import { normalizePlannerOutput } from "./planner.mjs";
import { createStore, FIXTURES_DIR } from "./store.mjs";
import { BEAM } from "./fixtures/record.mjs";
import { assertBeamEvent, assertReading } from "../../src/beam/contract.mjs";
import { INTENT_IDS } from "./gold.mjs";

const fixtureDoc = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "results", "r-v1.g-v3", "items.json"), "utf8"));
const byId = Object.fromEntries(fixtureDoc.items.map((i) => [i.id, i]));
const catalog = INTENT_IDS.map((id) => ({ id }));

test("the fixtures follow the beam contract: every event and every arm reading", () => {
  for (const [id, b] of Object.entries(BEAM)) {
    for (const e of b.events) assert.doesNotThrow(() => assertBeamEvent(e), id);
    for (const { readings } of armsOf(b.arms)) for (const r of readings) assert.doesNotThrow(() => assertReading(r, catalog), id);
  }
});

test("the run tree: open / closed with reason / won, closedBy, the winner, wall time; bad lines become problems", () => {
  const t = foldEvents(BEAM["orders-1"].events);
  assert.deepEqual(t.runs.map((r) => [r.id, r.status, r.reason]), [["run-static", "open", null], ["run-jev", "won", null], ["run-3", "closed", "precondition"]]);
  assert.equal(t.winner, "run-jev");
  assert.equal(t.question.recommended, "run-jev");
  assert.deepEqual([t.open, t.closed, t.closedBy, t.ms], [2, 1, { precondition: 1 }, 1210]);
  assert.equal(t.runs[1].rank, 1);
  assert.deepEqual(t.runs[0].forks, [{ point: "source", pick: "api", label: "from a new api field" }]);
  const text = ['{"t":"runOpened","run":"a","parent":null,"reading":{"intent":"update.prop","object":"prop","target":null,"layers":["ui"],"confidence":0.5},"forks":[]}', "not json", '{"t":"runClosed","run":"a","reason":"meh","detail":""}', '{"t":"runClosed","run":"b","reason":"cap","detail":"x"}', ""].join("\n");
  const { events, problems } = parseEvents(text);
  assert.equal(events.length, 2);
  assert.equal(problems.length, 2);
  assert.match(problems[1], /line 3: .*reason/);
  const tt = treeOf(text);
  assert.ok(tt.problems.some((p) => /b: event before runOpened/.test(p)));
  assert.equal(tt.ms, null);
  assert.equal(foldEvents([{ t: "runOpened", run: "x", reading: null, forks: [], at: 1000 }, { t: "done", outcome: "none", run: null, open: 0, closed: 0, at: 1500 }]).ms, 500);
  assert.deepEqual(readEvents("/nonexistent/events.jsonl"), { events: [], problems: [] });
});

test("item metrics: recall, prune accuracy and why, checks, time, per-arm accuracy and rescue", () => {
  const c2 = itemMetrics(byId["contacts-2"]);
  assert.equal(c2.nlpRecall, true);
  assert.deepEqual(c2.runs, { opened: 3, closed: 2, open: 1, closedBy: { goal: 1, emit: 1 } });
  assert.equal(c2.prune.accuracy, 1);
  assert.deepEqual(c2.checks, { tscFail: 1, conditionFail: 1, pass: true });
  assert.equal(c2.final.right, true);
  assert.deepEqual([c2.arms.static.correct, c2.arms.static.rescued, c2.arms.jev.correct, c2.arms.jev.rescued], [false, true, true, false]);
  assert.equal(c2.ms, 980);

  const o2 = itemMetrics(byId["orders-2"]);
  assert.equal(o2.final.right, false, "the beam ended on the wrong reading");
  assert.equal(o2.prune.rightKept, false);
  assert.deepEqual(o2.prune.rightClosed, [{ run: "run-2", reason: "precondition", detail: "the orders api has no status field" }]);
  assert.deepEqual(o2.prune.wrongKept, ["run-1"]);
  assert.equal(o2.prune.accuracy, 0);
  assert.equal(o2.arms.spacy.layersHit, true);
  assert.equal(o2.arms.static.rescued, false, "no rescue when the beam's final run is wrong too");

  assert.equal(itemMetrics(byId["orders-1"]).questions, 1);
  assert.equal(itemMetrics(byId["orders-1"]).checks.pass, null, "it asked: no plan to check yet");
  assert.equal(itemMetrics({ gold: null, beam: { events: [] } }), null);
  assert.equal(itemMetrics({ gold: byId["orders-1"].gold }), null, "no beam and no arms: nothing to measure");
});

test("setup metrics: rates and totals, per layer and per arm with the rescued count", () => {
  const m = setupMetrics(fixtureDoc.items);
  assert.equal(m.items, 6);
  assert.equal(m.nlpRecall, 1);
  assert.equal(m.finalRight, 0.833);
  assert.deepEqual([m.runsOpened, m.runsClosed, m.questions, m.tscFail, m.conditionFail], [13, 6, 1, 1, 1]);
  assert.deepEqual(m.closedBy, { structural: 1, precondition: 2, goal: 1, emit: 1, cap: 1 });
  assert.deepEqual(m.perArm.static, { items: 6, accuracy: 0.667, topK: 0.667, layers: 0.833, rescued: 1 });
  assert.equal(m.perArm["zero-shot"].rescued, 4);
  assert.deepEqual(Object.keys(m.perLayer).sort(), ["api", "ui"]);
  assert.equal(m.perLayer.api.items, 1);
  assert.equal(m.perLayer.api.finalRight, 0);
  assert.equal(setupMetrics([{ id: "x" }]), null);
});

test("the planner adapter takes runs from the events when the beam gives no runs, and the winner as recommended", () => {
  const p = normalizePlannerOutput({ events: BEAM["contacts-2"].events, arms: BEAM["contacts-2"].arms, paths: { "run-1": [{ layer: "hook", name: "useCallLog", status: "stub" }] } }, "beam");
  assert.deepEqual(p.runs.map((r) => r.id), ["run-1"]);
  assert.equal(p.recommended, "run-1");
  assert.equal(p.labels.intent, "update.handler");
  assert.deepEqual(p.path[0], { layer: "hook", label: "useCallLog", decision: "stub", picks: null, fork: false });
  assert.equal(p.beam.events.length, 7);
  const q = normalizePlannerOutput({ events: BEAM["orders-1"].events }, "beam");
  assert.deepEqual(q.runs.map((r) => r.id), ["run-static", "run-jev"]);
  assert.equal(q.recommended, "run-jev");
  assert.equal(q.question.text, "Should the total value come from an api field or be computed from the orders on the page?");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beam-ev-"));
  const f = path.join(dir, "events.jsonl");
  fs.writeFileSync(f, BEAM["orders-3"].events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  assert.equal(normalizePlannerOutput({ eventsFile: f }, "beam").beam.events.length, 5);
});

test("the view: the run tree always, per-item metrics only once the owner has graded (they compare with gold)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "beam-mv-"));
  const v = createStore({ resultsDir: path.join(d, "r"), runsDir: path.join(d, "x"), fixturesDir: FIXTURES_DIR }).view("r-v1.g-v3");
  const o1 = v.items.find((i) => i.id === "orders-1");
  assert.equal(o1.goldHidden, true);
  assert.ok(!("metrics" in o1) && !("beam" in o1));
  assert.equal(o1.tree.winner, "run-jev");
  assert.equal(o1.arms.jev[0].intent, "update.prop");
  const c1 = v.items.find((i) => i.id === "contacts-1");
  assert.equal(c1.metrics.final.right, true);
  assert.equal(v.metrics.items, 6);
});
