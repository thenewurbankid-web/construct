// Planner eval (#896): separation, versions, agreement math, review order, fixture replay. No model is ever called.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRubric, listVersions, loadPrompt, parseSetupId, setupId } from "./prompts.mjs";
import { checkGold, INTENT_IDS } from "./gold.mjs";
import { buildGraderInput, buildRequesterAnswerInput, appView, assertGraderInputClean, blindRuns, buildPlannerRequest } from "./inputs.mjs";
import { assertModel, checkGrade, createJudges, parseJsonReply } from "./judges.mjs";
import { itemAgreement, summarize, reviewOrder } from "./agreement.mjs";
import { createAskPlanner, createFixturePlanner, normalizePlannerOutput } from "./planner.mjs";
import { runAndSave } from "./pipeline.mjs";
import { createStore, FIXTURES_DIR } from "./store.mjs";
import { renderReport } from "./report.mjs";
import { fakeLlm } from "./fixtures/record.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(here, "..", "..", "examples");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "beam-"));
const dirsIn = (root) => ({ resultsDir: path.join(root, "results"), runsDir: path.join(root, "runs"), fixturesDir: FIXTURES_DIR });
const LINES = loadRubric().lines;

const SECRET_NOTES = "SECRET-NOTES-7f3a only the requester knows";
const item = {
  id: "contacts-9", app: "contacts", requirement: "Show the full name.",
  gold: { source: "requester", intent: "update.prop", object: "prop", target: { kind: "page", name: "GOLD-TARGET-91c" }, layers: ["ui"] },
  notes: SECRET_NOTES,
  plannerQuestion: { text: "Computed or api?", options: ["computed", "api"] },
  requesterAnswer: { answer: "Computed.", option: "computed" },
  recommended: "run-jev",
  runs: [
    { id: "run-static", labels: { intent: "update.prop", object: "prop", target: { kind: "page", name: "contacts" }, layers: ["ui"], by: "static" }, path: [{ layer: "source", label: "x", decision: "api", picks: { static: "api", jev: "computed" }, fork: true }], question: null },
    { id: "run-jev", labels: { intent: "update.prop", object: "prop", target: { kind: "page", name: "contacts" }, layers: ["ui"], by: "jev" }, path: [{ layer: "source", label: "x", decision: "computed", picks: null, fork: false }], question: null },
  ],
};

// ---------------------------------------------------------------------------------------------------- separation
test("the grader input never carries gold, private notes, the recommended run or real run ids", () => {
  for (const { blindId, run } of blindRuns(item.runs, item.id)) {
    const input = buildGraderInput(item, run, blindId);
    const s = JSON.stringify(input);
    for (const k of ["gold", "notes", "recommended", "GOLD-TARGET-91c", "SECRET-NOTES-7f3a", "run-jev", "run-static", "\"by\""]) assert.ok(!s.includes(k), `grader input leaks ${k}`);
    assert.match(input.run.id, /^[A-Z]$/);
    assert.equal(input.requirement, item.requirement);
  }
});

test("assertGraderInputClean refuses an input with a private key or the notes text", () => {
  assert.throws(() => assertGraderInputClean({ requirement: "x", run: { gold: {} } }), /private field/);
  assert.throws(() => assertGraderInputClean({ requirement: "x", recommended: "A" }), /private field/);
  assert.throws(() => assertGraderInputClean({ requirement: `x ${SECRET_NOTES}` }, item), /private notes/);
});

test("the planner only ever gets the requirement text; the requester's answer input has no gold", () => {
  assert.equal(buildPlannerRequest(item), "Show the full name.");
  const seen = [];
  const spy = { kind: "spy", ask: (r) => { seen.push(r); return { available: false, error: "spy" }; } };
  spy.ask(buildPlannerRequest(item));
  assert.deepEqual(seen, ["Show the full name."]);
  assert.throws(() => createFixturePlanner({}).ask({ requirement: "x", gold: {} }), /request text only/);
  const ans = buildRequesterAnswerInput({ view: { name: "contacts" }, requirement: item.requirement, notes: item.notes, question: item.plannerQuestion });
  assert.ok(!("gold" in ans) && !JSON.stringify(ans).includes("GOLD-TARGET-91c"));
});

test("the requester sees the app, not the planner's saved answers, decisions or the rubric", () => {
  const v = appView(examplesDir, "contacts");
  assert.deepEqual(Object.keys(v).sort(), ["about", "endpoints", "name", "page", "route", "story"]);
  assert.match(v.page, /data-dyn="fullName"/);
  const s = JSON.stringify(v);
  assert.ok(!s.includes("intent right") && !s.includes("\"answers\""));
});

test("a fake run's grader transcripts carry no gold or notes, and every run is graded before the reveal", async () => {
  const root = tmp();
  const dirs = dirsIn(root);
  const doc = await runAndSave({ requester: "v1", grader: "v2", apps: ["contacts", "orders"], items: 2, planner: "fixture", examplesDir, dirs, store: createStore(dirs), llm: fakeLlm("v2") });
  const orders = doc.items.find((i) => i.id === "orders-1");
  const runDir = path.join(dirs.runsDir, doc.setup, "orders-1");
  const graderFiles = fs.readdirSync(runDir).filter((f) => f.startsWith("grader-"));
  assert.deepEqual(graderFiles.sort(), ["grader-A.json", "grader-B.json"]);
  for (const f of graderFiles) {
    const t = JSON.parse(fs.readFileSync(path.join(runDir, f), "utf8"));
    const s = JSON.stringify(t.input);
    assert.ok(!s.includes(orders.notes) && !s.includes("\"gold\"") && !s.includes("recommended") && !s.includes("run-jev"));
  }
  assert.equal(orders.grader.revealedAfterGrading, true);
  assert.deepEqual(Object.keys(orders.grader.runScores).sort(), ["run-jev", "run-static"]);
  assert.deepEqual(orders.grader.scores, orders.grader.runScores[orders.recommended].scores);
  const planner = JSON.parse(fs.readFileSync(path.join(runDir, "planner.json"), "utf8"));
  assert.equal(typeof planner.request, "string");
  assert.ok(!JSON.stringify(planner).includes(orders.notes));
});

// ---------------------------------------------------------------------------------------------------- versions
test("prompts are versioned files; every transcript records file, version, hash, model opus and temperature", async () => {
  assert.deepEqual(listVersions("grader").map((v) => v.version), ["v2", "v1"]);
  assert.equal(loadPrompt("grader", "v1").file, "prompts/archive/grader.v1.md");
  assert.equal(loadPrompt("requester").version, "v1");
  const root = tmp();
  const dirs = dirsIn(root);
  const doc = await runAndSave({ requester: "v1", grader: "v1", apps: ["contacts"], items: 1, planner: "fixture", examplesDir, dirs, store: createStore(dirs), llm: fakeLlm("v1") });
  assert.equal(doc.setup, "r-v1.g-v1");
  assert.deepEqual(doc.versions, { requester: "v1", grader: "v1", rubric: "v1" });
  const dir = path.join(dirs.runsDir, "r-v1.g-v1", "contacts-1");
  for (const f of ["requester-write.json", "grader-A.json"]) {
    const t = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    assert.equal(t.model, "opus");
    assert.equal(t.temperature, null);
    assert.equal(t.temperatureEnforced, false);
    assert.match(t.promptSha, /^[0-9a-f]{12}$/);
    assert.ok(t.promptFile && t.promptVersion && t.at && t.input && typeof t.output === "string");
  }
  const g = JSON.parse(fs.readFileSync(path.join(dir, "grader-A.json"), "utf8"));
  assert.equal(g.promptFile, "prompts/archive/grader.v1.md");
  assert.equal(g.rubricVersion, "v1");
  assert.equal(doc.items[0].grader.rubricVersion, "v1");
});

test("the judges refuse any model but opus, fable above all", () => {
  assert.doesNotThrow(() => assertModel("opus"));
  assert.throws(() => assertModel("fable"), /fable/);
  assert.throws(() => assertModel("claude-fable-1"), /fable/);
  assert.throws(() => assertModel("sonnet"), /opus/);
  assert.throws(() => createJudges({ mode: "replay", requester: "v1", grader: "v1", runsDir: tmp(), model: "fable" }), /fable/);
});

test("setup ids round-trip; the rubric parses into its five lines", () => {
  assert.equal(setupId("v1", "v2"), "r-v1.g-v2");
  assert.deepEqual(parseSetupId("r-v1.g-v2"), { requester: "v1", grader: "v2" });
  assert.equal(parseSetupId("../etc"), null);
  assert.deepEqual(LINES.map((l) => [l.id, l.max]), [["intent", 2], ["path", 3], ["reuse", 3], ["question", 2], ["unused", 2]]);
});

test("gold labels come only from the closed sets", () => {
  assert.ok(INTENT_IDS.includes("update.prop") && INTENT_IDS.includes("add.handler"));
  assert.equal(checkGold({ intent: "update.prop", object: "prop", target: { kind: "page", name: "x" }, layers: ["ui"] }).ok, true);
  const bad = checkGold({ intent: "paint.wall", object: "prop", target: { kind: "room" }, layers: ["db"] });
  assert.equal(bad.ok, false);
  assert.equal(bad.problems.length, 4);
  assert.match(checkGold({ intent: "update.prop", object: "page", target: { kind: "page" }, layers: ["ui"] }).problems[0], /does not match/);
});

test("grader replies are parsed and checked against the rubric", () => {
  assert.deepEqual(parseJsonReply("```json\n{\"a\":1}\n```"), { a: 1 });
  assert.deepEqual(parseJsonReply("Sure: {\"a\":2} done"), { a: 2 });
  const g = checkGrade({ scores: { intent: 2, path: 4, reuse: 1, question: "2" }, justification: "one\ntwo" }, LINES);
  assert.deepEqual(g.scores, { intent: 2, path: null, reuse: 1, question: null, unused: null });
  assert.equal(g.justification, "one");
  assert.equal(g.problems.length, 3);
});

// ---------------------------------------------------------------------------------------------------- agreement
const S = (intent, p, reuse, question, unused) => ({ intent, path: p, reuse, question, unused });

test("agreement per line and overall; disagree2 on a total or a single line off by two", () => {
  const a = itemAgreement({ grader: { scores: S(2, 3, 3, 1, 2) }, owner: { scores: S(2, 3, 3, 0, 2) } }, LINES);
  assert.deepEqual(a.lines.question, { grader: 1, owner: 0, diff: -1, agree: false });
  assert.deepEqual(a.overall, { grader: 11, owner: 10, diff: -1 });
  assert.equal(a.disagree2, false);
  assert.equal(itemAgreement({ grader: { scores: S(2, 3, 0, 2, 2) }, owner: { scores: S(2, 1, 2, 2, 2) } }, LINES).disagree2, true, "one line off by 2, total equal");
  assert.equal(itemAgreement({ grader: { scores: S(2, 3, 3, 2, 2) }, owner: { scores: S(1, 2, 3, 2, 2) } }, LINES).disagree2, true, "total off by 2");
  const none = itemAgreement({ grader: { scores: S(2, 3, 3, 2, 2) }, owner: null }, LINES);
  assert.equal(none.overall, null);
  assert.equal(none.compared, 0);
});

test("summary: means per judge over what each scored, agreement rate over lines both scored", () => {
  const items = [
    { id: "a", grader: { scores: S(2, 3, 3, 2, 2) }, owner: { scores: S(2, 3, 3, 2, 2) } },
    { id: "b", grader: { scores: S(0, 0, 0, 0, 0) }, owner: { scores: S(2, 3, 3, 2, 2) } },
    { id: "c", grader: { scores: S(1, 1, 1, 1, 1) }, owner: null },
  ];
  const s = summarize(items, LINES);
  assert.equal(s.maxTotal, 12);
  assert.equal(s.mean.grader, Math.round(((12 + 0 + 5) / 3) * 100) / 100);
  assert.equal(s.mean.owner, 12);
  assert.equal(s.agreementRate, 0.5);
  assert.equal(s.disagree2, 1);
  assert.deepEqual(s.graded, { grader: 3, owner: 2, both: 2 });
  assert.equal(s.perLine.path.owner, 3);
});

test("review order: disagree>=2 first (largest gap first), then owner-ungraded, then agreed", () => {
  const items = [
    { id: "agree", grader: { scores: S(2, 3, 3, 2, 2) }, owner: { scores: S(2, 3, 3, 2, 2) } },
    { id: "ungraded", grader: { scores: S(2, 3, 3, 2, 2) }, owner: null },
    { id: "gap2", grader: { scores: S(2, 3, 3, 2, 2) }, owner: { scores: S(2, 3, 3, 0, 2) } },
    { id: "gap5", grader: { scores: S(2, 3, 3, 2, 2) }, owner: { scores: S(0, 0, 3, 2, 2) } },
  ];
  assert.deepEqual(reviewOrder(items, LINES).map((i) => i.id), ["gap5", "gap2", "ungraded", "agree"]);
});

// ---------------------------------------------------------------------------------------------------- replay
test("dry-run replays the committed fixtures exactly, with no model call", async () => {
  const root = tmp();
  const dirs = dirsIn(root);
  for (const grader of ["v1", "v2"]) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "results", `r-v1.${"g-" + grader}`, "items.json"), "utf8"));
    const doc = await runAndSave({ requester: "v1", grader, apps: ["contacts", "orders"], items: 6, dryRun: true, examplesDir, dirs, store: createStore(dirs) });
    assert.equal(doc.calls, 0);
    assert.equal(doc.mode, "replay");
    assert.deepEqual(doc.items.map((i) => [i.id, i.requirement, i.grader?.scores, i.requesterAnswer]), fixture.items.map((i) => [i.id, i.requirement, i.grader?.scores, i.requesterAnswer]));
    assert.ok(doc.items.every((i) => i.transcripts.every((t) => t.inputDrift === false)), "replayed inputs equal the recorded ones");
  }
  await assert.rejects(runAndSave({ requester: "v1", grader: "v2", apps: ["roster"], items: 1, dryRun: true, examplesDir, dirs, store: createStore(dirs) }), /no recorded transcript/);
});

test("store: fixture setups list, owner grades go to resultsDir, gold stays hidden until the owner grades", () => {
  const root = tmp();
  const store = createStore(dirsIn(root));
  assert.deepEqual(store.listSetups().map((s) => s.id).sort(), ["r-v1.g-v1", "r-v1.g-v2"]);
  const v = store.view("r-v1.g-v1");
  assert.equal(v.items[0].id, "orders-2", "the disagree>=2 item comes first");
  const ungraded = v.items.find((i) => i.id === "orders-1");
  assert.equal(ungraded.goldHidden, true);
  assert.ok(!("gold" in ungraded) && !("notes" in ungraded));
  assert.deepEqual(store.saveOwner("r-v1.g-v1", "orders-1", { scores: { intent: 9 } }), { ok: false, error: "intent must be an integer 0..2" });
  assert.equal(store.saveOwner("r-v1.g-v1", "orders-1", { scores: S(2, 3, 2, 2, 2), note: "fine" }).ok, true);
  assert.ok(fs.existsSync(path.join(root, "results", "r-v1.g-v1", "owner.json")));
  const after = store.view("r-v1.g-v1").items.find((i) => i.id === "orders-1");
  assert.equal(after.goldHidden, false);
  assert.equal(after.gold.intent, "update.prop");
  assert.equal(after.goldMatch.intent, true);
  assert.equal(after.agreement.overall.diff, 0);
  assert.equal(store.view("../x"), null);
  assert.match(renderReport(store), /\| r-v1\.g-v1 \| fixture \|/);
});

// ---------------------------------------------------------------------------------------------------- planner adapter
test("the ask.mjs planner degrades when the CLI is missing or fails, and normalizes its JSON", () => {
  const missing = createAskPlanner({ askPath: "/nonexistent/ask.mjs" }).ask("x");
  assert.equal(missing.available, false);
  assert.match(missing.error, /not there yet/);
  const askPath = fileURLToPath(import.meta.url); // any existing file; the run is faked
  const failed = createAskPlanner({ askPath, run: () => ({ status: 2, stdout: "", stderr: "boom" }) }).ask("x");
  assert.match(failed.error, /exited 2: boom/);
  const out = { labels: { intent: "update.prop", layers: ["ui"] }, path: [{ layer: "hook", name: "useX", status: "existing stub" }, "service: create FORK"], question: "Which?" };
  const seen = [];
  const ok = createAskPlanner({ askPath, run: (bin, args) => { seen.push(args.slice(1)); return { status: 0, stdout: JSON.stringify(out) }; } }).ask("Show x");
  assert.deepEqual(seen, [["Show x", "--json"]]);
  assert.equal(ok.available, true);
  assert.equal(ok.runs.length, 1);
  assert.equal(ok.recommended, "run-1");
  assert.equal(ok.labels.object, "prop");
  assert.deepEqual(ok.path[0], { layer: "hook", label: "useX", decision: "stub", picks: null, fork: false });
  assert.equal(ok.path[1].fork, true);
  assert.deepEqual(ok.question, { text: "Which?", options: [] });
  const multi = normalizePlannerOutput({ runs: [{ id: "a", path: [] }, { id: "b", path: [] }], recommended: "b" }, "x");
  assert.equal(multi.recommended, "b");
});
