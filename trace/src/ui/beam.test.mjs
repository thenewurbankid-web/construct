// #896: the planner eval page's pure renderers, over the committed fixtures (no DOM, no server).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore, FIXTURES_DIR } from "../../eval/beam/store.mjs";
import { renderSummary, renderList, renderPath, renderDetail, renderCompare, renderSetupBar, renderGold } from "./beam.mjs";

const d = fs.mkdtempSync(path.join(os.tmpdir(), "beam-ui-"));
const store = createStore({ resultsDir: path.join(d, "results"), runsDir: path.join(d, "runs"), fixturesDir: FIXTURES_DIR });
const v1 = store.view("r-v1.g-v1");
const v2 = store.view("r-v1.g-v2");

test("summary bar: means per judge, agreement rate, disagree count", () => {
  const html = renderSummary(v1);
  assert.match(html, /data-testid="mean-grader">10\.17</);
  assert.match(html, /data-testid="mean-owner">9</);
  assert.match(html, /data-testid="agreement-rate">75%</);
  assert.match(html, /data-testid="disagree-count">1</);
});

test("item list: the disagree>=2 item first with its badge; ungraded items say so", () => {
  const html = renderList(v1, "orders-2");
  assert.ok(html.indexOf('data-item="orders-2"') < html.indexOf('data-item="orders-1"'));
  assert.match(html, /Δ -3 review/);
  assert.match(html, /not graded/);
});

test("path: decisions as chips, FORK and both pickers shown, text escaped", () => {
  const html = renderPath([{ layer: "hook", label: "<b>x</b>", decision: "stub", picks: { static: "api", jev: "computed" }, fork: true }]);
  assert.match(html, /Stub: complete it/);
  assert.match(html, /FORK/);
  assert.match(html, /static: api · jev: computed/);
  assert.ok(!html.includes("<b>x</b>"));
});

test("detail: requirement, question and answer, run tree with blind ids and the recommended mark, grader line, owner buttons, agreement", () => {
  const item = v1.items.find((i) => i.id === "orders-1");
  const html = renderDetail(item, v1, null);
  assert.match(html, /Show the total value of all orders/);
  assert.match(html, /api field or be computed/);
  assert.match(html, /Add up the totals/);
  assert.equal((html.match(/data-testid="beam-run"/g) ?? []).length, 2);
  assert.match(html, /graded blind as run [AB]/);
  assert.match(html, /recommended/);
  assert.match(html, /data-testid="grader-justification">Right computed path/);
  assert.equal((html.match(/class="sbtn"/g) ?? []).length, 3 + 4 + 4 + 3 + 3);
  assert.match(html, /data-testid="overall-diff">–</);
  assert.match(renderGold(item), /appear once you have graded/);
  assert.ok(!html.includes(item.requirement + "\"gold\""));
});

test("compare: two setups side by side, per line", () => {
  const html = renderCompare(v1, v2);
  assert.match(html, /r-v1\.g-v1/);
  assert.match(html, /r-v1\.g-v2/);
  assert.match(html, /question \(0–2\)/);
});

test("setup bar: replay only unless the server allows live runs", () => {
  const meta = { setups: store.listSetups(), versions: { requester: ["v1"], grader: ["v2", "v1"] }, live: false };
  assert.match(renderSetupBar(meta, { setup: "r-v1.g-v1", compare: "", requester: "v1", grader: "v1" }), /replay only/);
  assert.match(renderSetupBar({ ...meta, live: true }, { setup: "r-v1.g-v1", compare: "", requester: "v1", grader: "v1" }), /Live \(calls Opus\)/);
});

// #902: the beam's run tree, the arms' readings and the deterministic metrics (rubric v2 setup r-v1.g-v3).
test("beam tree, arms and metrics render from the view; per-item metrics wait for the owner's grade", async () => {
  const { renderTree, renderArms, renderMetrics, renderItemMetrics } = await import("./beam.mjs");
  const v3 = store.view("r-v1.g-v3");
  const o1 = v3.items.find((i) => i.id === "orders-1");
  const tree = renderTree(o1.tree, o1.id);
  assert.match(tree, /data-testid="beam-tree" data-item="orders-1"/);
  assert.match(tree, /3 opened · 1 closed · 2 kept · question · 1210 ms/);
  assert.match(tree, /data-run="run-3" data-status="closed".*closed: precondition/s);
  assert.match(tree, /data-run="run-jev" data-status="won".*recommended/s);
  assert.match(tree, /Beam asks:/);
  assert.match(renderTree(null, "x"), /No beam events/);
  const arms = renderArms(o1.arms);
  assert.equal((arms.match(/<tr><th scope="row">/g) ?? []).length, 5);
  assert.match(arms, /zero-shot/);
  assert.match(renderItemMetrics(o1), /appear once you have graded/);
  assert.match(renderItemMetrics(v3.items.find((i) => i.id === "orders-2")), /right run closed: run-2 \(precondition\)/);
  const m = renderMetrics(v3.metrics);
  assert.match(m, /<th scope="row">all<\/th><td>6<\/td><td>100%<\/td>/);
  assert.match(m, /layer api/);
  assert.match(m, /<th scope="row">static<\/th><td>67%<\/td><td>67%<\/td><td>83%<\/td><td>1<\/td>/);
  assert.match(renderMetrics(null), /No beam metrics/);
  const detail = renderDetail(o1, v3, null, { ...o1.tree, done: null, runs: o1.tree.runs.slice(0, 1), closed: 0, open: 1 });
  assert.match(detail, /1 opened · 0 closed · 1 kept · running…/, "a streamed tree replaces the stored one");
  assert.match(renderOwnerFormV2(v3), /data-line="clarity" data-score="2"/);
});

function renderOwnerFormV2(v) { return renderDetail(v.items[0], v, null); }
