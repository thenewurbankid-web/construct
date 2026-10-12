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
