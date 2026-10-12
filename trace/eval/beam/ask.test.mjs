// #904: the real trace/tools/jev/ask.mjs drives the beam planner, and the eval's createAskPlanner reads its runs, the
// recommended run, the one question and the live events. No model is called: the arms stay static (LINE_ARMS_SHADOW=0),
// jev points at a closed port, and the judges are the scripted fake.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAskPlanner, normalizePlannerOutput } from "./planner.mjs";
import { runSetup } from "./pipeline.mjs";
import { createJudges } from "./judges.mjs";
import { readEvents, foldEvents } from "./beam-tree.mjs";
import { FIXTURES_DIR } from "./store.mjs";
import { fakeLlm, REQUESTER } from "./fixtures/record.mjs";
import { assertBeamEvent, assertBeamQuestion, assertReading } from "../../src/beam/contract.mjs";
import { ask } from "../../tools/jev/ask.mjs";
import { exampleFor, armsOut } from "../../tools/jev/askBeam.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(here, "..", "..", "examples");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "beam-ask-"));
// No model: no shadow arm, jev on a closed port.
process.env.LINE_ARMS_SHADOW = "0";
process.env.JEV_URL = "http://127.0.0.1:9";
process.env.JEV_ASK_LOG = "0"; // the owner's ask log stays clean
const DEALS = "Show each deal's owner and CSM in the deals list.";

test("exampleFor: the Trace example a request names (all of a feature's parts; most parts wins); null when none", () => {
  const ex = (r) => { const d = exampleFor(r); return d && path.basename(d); };
  assert.equal(ex("In the contacts table, show each person's full name."), "contacts");
  assert.equal(ex("Let me mark an order as shipped from the orders list."), "orders");
  assert.equal(ex("Show the product history next to each product."), "products-history");
  assert.equal(ex(DEALS), "deals");
  assert.equal(ex("Make the button blue."), null);
});

test("armsOut names the arms as the eval does: lr + nb -> sklearn, nli -> zero-shot", () => {
  const r = (intent, confidence) => ({ intent, object: intent.split(".")[1], target: null, layers: ["ui"], confidence });
  const out = armsOut({ static: { readings: [r("update.prop", 0.8)] }, lr: { readings: [r("update.prop", 0.6)] }, nb: { readings: [r("add.prop", 0.7)] }, nli: { readings: [r("add.component", 0.5)] }, spacy: null });
  assert.deepEqual(Object.keys(out), ["static", "sklearn", "zero-shot"]);
  assert.deepEqual(out.sklearn.map((x) => x.intent), ["add.prop", "update.prop"]);
});

test("ask(): a forked page gives runs with state + reason, the one closed question, the arms, and streams events", async () => {
  const eventsFile = path.join(tmp(), "events.jsonl");
  const r = await ask(DEALS, { jev: false, log: null, eventsFile });
  assert.equal(r.example, "trace/examples/deals");
  assert.equal(r.outcome, "question");
  assertBeamQuestion(r.question);
  assert.equal(r.recommended, r.question.recommended);
  assert.equal(r.steps, null);
  for (const run of r.runs) {
    assert.ok(["open", "closed"].includes(run.state));
    assert.equal(run.state === "closed", Boolean(run.reason));
    assert.ok(!("score" in run) && !("rank" in run), "runs carry no score or rank");
  }
  assert.deepEqual(r.runs.filter((x) => x.state === "open").map((x) => x.id).sort(), r.question.options.map((o) => o.id).sort());
  for (const x of r.arms.static) assertReading(x);
  const lines = fs.readFileSync(eventsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const e of lines) assertBeamEvent(e);
  assert.deepEqual(lines, r.events);
  assert.equal(lines.at(-1).t, "done");
  assert.ok(lines.every((e) => Number.isFinite(e.at)) && Number.isFinite(lines.at(-1).ms));
});

test("ask(): a page with no fork gives one run and its plan steps; --no-beam keeps the old answer", async () => {
  const r = await ask("Let me mark an order as shipped from the orders list.", { jev: false, log: null, eventsFile: null });
  assert.equal(r.outcome, "plan");
  assert.equal(r.recommended, "r0");
  assert.ok(r.steps.length > 1 && r.steps.every((s) => s.tool === "trace.emit"));
  assert.equal(r.question, null);
  const off = await ask("Let me mark an order as shipped from the orders list.", { jev: false, log: null, beam: false });
  assert.equal(off.outcome, null);
  assert.deepEqual(off.runs, []);
});

test("createAskPlanner runs the real ask.mjs: open runs graded, recommended among them, question neutral, events live", () => {
  const eventsFile = path.join(tmp(), "events.jsonl");
  const a = createAskPlanner().ask(DEALS, { eventsFile });
  assert.equal(a.available, true, a.error);
  assert.ok(a.runs.length >= 2);
  assert.ok(a.runs.some((x) => x.id === a.recommended));
  assert.ok(a.runs.every((x) => x.labels && x.path.some((n) => n.fork)));
  // The question's options are sentences in a sorted order, so the first one is not the recommended run.
  assert.deepEqual(a.question.options, [...a.question.options].sort());
  assert.ok(a.question.options.every((o) => !/^r\d+$/.test(o)));
  const tree = foldEvents(readEvents(eventsFile).events);
  assert.equal(tree.done.outcome, "question");
  assert.deepEqual(tree.runs.filter((x) => x.status !== "closed").map((x) => x.id).sort(), a.runs.map((x) => x.id).sort());
  assert.ok(tree.closedBy.forked >= 1);
  assert.ok(a.beam.events.length === tree.runs.length + Object.values(tree.closedBy).reduce((s, n) => s + n, 0) + a.runs.length + 2);
  assert.ok(Array.isArray(a.arms.static));
});

test("ask(): the readings come from the Trace example's facts: real intent, the page as target, on every app", async () => {
  const cases = { contacts: "When I press Call on a contact, log that we called that person.", orders: "Show the total value of all orders in the header next to the order count.", deals: DEALS, invoices: "Let me archive an invoice from the invoices list.", roster: "Show each project's owner and backup in the roster." };
  for (const [app, request] of Object.entries(cases)) {
    const r = await ask(request, { jev: false, log: null, eventsFile: null, example: path.join(examplesDir, app) });
    assert.equal(r.example, `trace/examples/${app}`);
    assert.notEqual(r.exampleRead.labels.intent, "unknown", `${app}: ${r.exampleRead.normalized}`);
    assert.notEqual(r.arms.static[0].intent, "unknown");
    for (const run of r.runs) assert.deepEqual(run.labels.target, { kind: "page", name: app });
  }
});

test("createAskPlanner passes the item's app as --example (request text unchanged); the eval passes the app", () => {
  const seen = [];
  const run = (bin, args) => { seen.push(args.slice(1)); return { status: 0, stdout: JSON.stringify({ labels: { intent: "update.prop" }, path: [] }) }; };
  const askPath = fileURLToPath(import.meta.url);
  createAskPlanner({ askPath, run }).ask("Show x", { example: "/ex/deals" });
  createAskPlanner({ askPath, run }).ask("Show x");
  assert.deepEqual(seen, [["Show x", "--json", "--example", "/ex/deals"], ["Show x", "--json"]]);
});

test("normalizePlannerOutput: every run closed -> nothing to grade, the tree still there", () => {
  const out = normalizePlannerOutput({ labels: {}, runs: [{ id: "r0", state: "closed", reason: "emit", labels: null, path: [] }], events: [{ t: "runOpened", run: "r0", parent: null, reading: { intent: "unknown", object: null, target: null, layers: [], confidence: 0 }, forks: [] }, { t: "runClosed", run: "r0", reason: "emit", detail: "x" }, { t: "done", outcome: "none", run: null, open: 0, closed: 1 }] }, "ask");
  assert.equal(out.available, true);
  assert.deepEqual(out.runs, []);
  assert.equal(out.recommended, null);
  assert.equal(out.beam.events.length, 3);
});

test("the eval end to end over the real ask.mjs with the fake judge: 6 items, graded blind, 0 Opus calls", async () => {
  const root = tmp();
  const runsDir = path.join(root, "runs");
  const judges = createJudges({ mode: "fake", requester: "v1", grader: "v3", runsDir, replayDirs: [path.join(FIXTURES_DIR, "runs")], llm: fakeLlm("v3") });
  const doc = await runSetup({ apps: ["contacts", "orders"], items: 6, examplesDir, judges, planner: createAskPlanner(), runsDir, mode: "fake" });
  assert.equal(doc.items.length, Object.keys(REQUESTER).length);
  for (const it of doc.items) {
    assert.equal(it.planner.available, true, it.planner.error);
    assert.ok(it.runs.length >= 1 && it.runs.some((x) => x.id === it.recommended));
    assert.ok(it.beam.events.length >= 3);
    assert.deepEqual(Object.keys(it.grader.runScores).sort(), it.runs.map((x) => x.id).sort());
    const dir = path.join(runsDir, judges.setup, it.id);
    assert.ok(fs.existsSync(path.join(dir, "events.jsonl")));
    for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("grader-"))) {
      const s = JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).input);
      assert.ok(!s.includes("recommended") && !s.includes("\"gold\"") && !s.includes(it.notes) && !/"r\d+"/.test(s));
    }
  }
  // Every judge call went to the scripted fake (mode "fake"), none to Opus.
  const transcripts = doc.items.flatMap((it) => it.transcripts);
  assert.equal(judges.calls, transcripts.length);
  assert.ok(transcripts.every((t) => t.mode === "fake"));
});
